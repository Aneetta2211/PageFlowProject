const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema'); 
const { addToWallet } = require("../../controllers/user/walletController");


const renderOrderPage = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        
        const statusFilter = req.query.status || '';
        const sortBy = req.query.sort || 'date-desc';
        const searchQuery = req.query.search || '';

        
        const query = {};
        if (statusFilter && statusFilter !== 'All') {
    query.status = statusFilter;
}

if (searchQuery) {
    query.orderId = { $regex: searchQuery, $options: 'i' }; 
}


        
        let sortOption = {};
       if (sortBy === 'date-asc') {
    sortOption.createdOn = 1;
} else if (sortBy === 'date-desc') {
    sortOption.createdOn = -1;
}else if (sortBy === 'id-asc') {
            sortOption.orderId = 1;
        }

        
        const orders = await Order.find(query)
            .populate('user', 'name email')
            .sort(sortOption)
            .skip(skip)
            .limit(limit)
            .lean();

        
        const formattedOrders = await Promise.all(orders.map(async (order) => {
            const addressDoc = await Address.findOne({
                userId: order.user._id,
                'address._id': order.address
            }).lean();

            let addressDetails = null;
            if (addressDoc && addressDoc.address) {
                addressDetails = addressDoc.address.find(addr => 
                    addr._id.toString() === order.address.toString()
                );
            }

            return {
                ...order,
                address: addressDetails || null
            };
        }));

        
        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        const products = await Product.find({}, 'productId name stock').lean();

        res.render('admin/orders', {
            orders: formattedOrders,
            products,
            currentPage: page,
            totalPages,
            statusFilter, 
            sortBy 
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
            .populate('cancelledItems.product')
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
            status: order.status,
            cancelledItems: order.cancelledItems.map(item => ({
                productName: item.product?.productName,
                quantity: item.quantity,
                cancelReason: item.cancelReason
            }))
        });

        
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
        const validStatuses = ['Placed', 'Pending', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Return Request', 'Returned', 'Return Denied'];
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
const cancelOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;

        const order = await Order.findOne({ orderId }).populate('orderedItems.product');
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        if (['Cancelled', 'Delivered', 'Returned', 'Return Request'].includes(order.status)) {
            return res.status(400).json({
                success: false,
                error: `Cannot cancel order in ${order.status} status`
            });
        }

        
        const refundAmount = order.orderedItems.reduce((total, item) => {
            return total + (item.price * item.quantity);
        }, 0);

        
        order.status = 'Cancelled';
        order.cancelReason = reason || 'No reason provided';
        order.cancelledItems = order.orderedItems.map(item => ({
            product: item.product._id,
            price: item.price,
            quantity: item.quantity,
            cancelReason: reason || 'No reason provided',
            cancelledAt: new Date()
        }));
        order.orderedItems = [];

       
        if (refundAmount > 0) {
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for cancelled order #${orderId}`
            });
            console.log(`Refunded ₹${refundAmount} to wallet for cancelled order ${orderId}`);
        }

      
        for (const item of order.cancelledItems) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { quantity: item.quantity }
            });
            console.log(`Incremented stock for product ${item.product} by ${item.quantity}`);
        }

        await order.save();
        console.log(`Order ${orderId} cancelled successfully. Refunded ₹${refundAmount} to wallet.`);

        res.json({
            success: true,
            message: `Order cancelled successfully. ₹${refundAmount.toFixed(2)} refunded to wallet.`
        });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({
            success: false,
            error: `Failed to cancel order: ${error.message}`
        });
    }
};

const cancelOrderItem = async (req, res) => {
    try {
        const { orderId, productId } = req.params;
        const { reason } = req.body;

        const order = await Order.findOne({ orderId }).populate('orderedItems.product');
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        if (['Cancelled', 'Delivered', 'Returned', 'Return Request'].includes(order.status)) {
            return res.status(400).json({
                success: false,
                error: `Cannot cancel items in ${order.status} status`
            });
        }

        const itemIndex = order.orderedItems.findIndex(item => item.product._id.toString() === productId);
        if (itemIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Item not found in order'
            });
        }

        const item = order.orderedItems[itemIndex];
        const refundAmount = item.price * item.quantity;



        order.cancelledItems.push({
            product: item.product._id,
            price: item.price,
            quantity: item.quantity,
            cancelReason: reason || 'No reason provided',
            cancelledAt: new Date()
             
        });

      
        order.orderedItems.splice(itemIndex, 1);

        
        order.finalAmount = order.orderedItems.reduce((total, item) => total + (item.price * item.quantity), 0);

        
        if (refundAmount > 0) {
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for cancelled item in order #${orderId}`
            });
            console.log(`Refunded ₹${refundAmount} to wallet for cancelled item in order ${orderId}`);
        }

        
        await Product.findByIdAndUpdate(item.product._id, {
            $inc: { quantity: item.quantity }
        });
        console.log(`Incremented stock for product ${item.product._id} by ${item.quantity}`);

       
        if (order.orderedItems.length === 0) {
            order.status = 'Cancelled';
            order.cancelReason = reason || 'All items cancelled';
        }

        await order.save();
        console.log(`Item ${productId} in order ${orderId} cancelled successfully. Refunded ₹${refundAmount} to wallet.`);

        res.json({
            success: true,
            message: `Item cancelled successfully. ₹${refundAmount.toFixed(2)} refunded to wallet.`
        });
    } catch (error) {
        console.error('Error cancelling item:', error);
        res.status(500).json({
            success: false,
            error: `Failed to cancel item: ${error.message}`
        });
    }
};

const verifyReturnRequest = async (req, res) => {
    try {
        const { orderId, status } = req.body; 

        
        const order = await Order.findOne({ orderId })
            .populate('user')
            .populate('orderedItems.product')
            .populate('cancelledItems.product');

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'Return Request' || !order.returnRequested) {
            return res.status(400).json({ error: 'No valid return request found for this order' });
        }

       
        if (status === 'Approved') {
            order.status = 'Returned';
            order.returnStatus = 'Approved';

            
            const refundAmount = order.finalAmount; 
            let userWallet = await Wallet.findOne({ user: order.user._id });

            if (!userWallet) {
                userWallet = new Wallet({
                    user: order.user._id,
                    balance: 0,
                    transactions: []
                });
            }

            userWallet.balance += refundAmount;
            userWallet.transactions.push({
                amount: refundAmount,
                type: 'credit',
                description: `Refund for returned order ${orderId}`,
                date: new Date()
            });

            await userWallet.save();

        } else {
            order.status = 'Return Denied';
            order.returnStatus = 'Denied';
        }

        await order.save();

        res.status(200).json({ message: `Return request ${status.toLowerCase()} successfully` });
    } catch (error) {
        console.error('Error verifying return request:', error);
        res.status(500).json({ error: 'Server error while verifying return request' });
    }
};

module.exports = {
    renderOrderPage,
    renderOrderDetailsPage,
    updateOrderStatus,
    cancelOrder,
    cancelOrderItem,
    verifyReturnRequest
};

