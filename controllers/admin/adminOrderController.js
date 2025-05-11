const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Order = require('../../models/orderSchema');
const { addToWallet } = require("../../controllers/user/walletController")

const renderOrderPage = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 3;
        const skip = (page - 1) * limit;

        const orders = await Order.find()
            .populate('user', 'name email')
            .sort({ orderDate: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const totalOrders = await Order.countDocuments();
        const totalPages = Math.ceil(totalOrders / limit);

        const products = await Product.find({}, 'productId name stock')
            .lean();

        res.render('admin/orders', {
            orders,
            products,
            currentPage: page,
            totalPages,
        });
    } catch (error) {
        console.error('Error rendering order page:', error);
        res.status(500).send('Internal Server Error');
    }
};

const renderOrderDetailsPage = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ orderId })
            .populate('user', 'name email')
            .populate('orderedItems.product')
            .lean();

        if (!order) {
            console.error(`Order with orderId ${orderId} not found`);
            return res.status(404).send('Order not found');
        }

        console.log('Fetched order details:', {
            orderId: order.orderId,
            returnRequested: order.returnRequested,
            returnStatus: order.returnStatus,
            returnReason: order.returnReason,
            status: order.status
        });

        // Check for inconsistencies between status and returnRequested
        if (order.status === 'Return Request' && !order.returnRequested) {
            console.warn(`Inconsistency detected for orderId ${orderId}: status is 'Return Request' but returnRequested is false`);
        }

        let address = null;
        if (order.address && order.user) {
            const addressDoc = await Address.findOne({
                userId: order.user._id,
                'address._id': order.address
            });
            if (addressDoc) {
                address = addressDoc.address.find(addr => addr._id.equals(order.address));
            }
        }

        if (!address) {
            console.warn(`No address found for orderId ${orderId}`);
        }

        const orderWithAddress = {
            ...order,
            address: address || null
        };

        res.render('admin/order-details', { order: orderWithAddress });
    } catch (error) {
        console.error('Error rendering order details page:', error);
        res.status(500).send('Internal Server Error');
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        const validStatuses = ['Pending', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Return Request', 'Returned', 'Return Denied'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const order = await Order.findOneAndUpdate(
            { orderId },
            { status },
            { new: true }
        );

        if (!order) {
            return res.status(400).json({ error: 'Order not found' });
        }

        res.json({ success: true, message: 'Order status updated successfully' });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

const verifyReturnRequest = async (req, res) => {
    try {
        const { orderId, status } = req.body;
        const validReturnStatuses = ['Approved', 'Denied'];
        if (!validReturnStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid return status: ${status}. Must be 'Approved' or 'Denied'.` });
        }

        const order = await Order.findOne({ orderId }).populate('orderedItems.product');
        if (!order) {
            console.error(`Order with orderId ${orderId} not found`);
            return res.status(404).json({ error: 'Order not found' });
        }

        console.log('Verifying return request:', {
            orderId,
            status,
            currentReturnRequested: order.returnRequested,
            currentReturnStatus: order.returnStatus,
            currentOrderStatus: order.status
        });

        if (!order.returnRequested) {
            console.error(`No return request found for orderId ${orderId}`);
            return res.status(400).json({ 
                error: `No return request found for this order. Current status: ${order.status}, returnRequested: ${order.returnRequested}` 
            });
        }

        order.returnStatus = status;
        if (status === 'Approved') {
            order.status = 'Returned';
            // Calculate refund amount (sum of price * quantity for all ordered items)
            const refundAmount = order.orderedItems.reduce((total, item) => {
                return total + (item.price * item.quantity);
            }, 0);

            // Add refund to user's wallet
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for order #${orderId}`
            });

            // Increment stock for returned products
            for (const item of order.orderedItems) {
                await Product.findByIdAndUpdate(item.product._id, {
                    $inc: { quantity: item.quantity }
                });
                console.log(`Incremented stock for product ${item.product._id} by ${item.quantity}`);
            }
        } else if (status === 'Denied') {
            order.status = 'Return Denied';
        }

        await order.save();
        console.log(`Return request ${status.toLowerCase()} for orderId ${orderId}. New status: ${order.status}, returnStatus: ${order.returnStatus}`);

        res.json({ success: true, message: `Return request ${status.toLowerCase()} successfully` });
    } catch (error) {
        console.error('Error verifying return request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    renderOrderPage,
    renderOrderDetailsPage,
    updateOrderStatus,
    verifyReturnRequest
};