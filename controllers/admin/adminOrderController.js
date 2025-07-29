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
    const users = await User.find({
        $or: [
            { name: { $regex: searchQuery, $options: 'i' } },
            { email: { $regex: searchQuery, $options: 'i' } }
        ]
    }, '_id');

    const userIds = users.map(u => u._id);

    query.$or = [
        { orderId: { $regex: searchQuery, $options: 'i' } },
        { user: { $in: userIds } }
    ];
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
    let addressDetails = null;

    if (order.user) {
        const addressDoc = await Address.findOne({
            userId: order.user._id,
            'address._id': order.address
        }).lean();

        if (addressDoc && addressDoc.address) {
            addressDetails = addressDoc.address.find(addr =>
                addr._id.toString() === order.address?.toString()
            );
        }
    } else {
        console.warn(`User missing for order ${order.orderId}`);
    }

    return {
        ...order,
        address: addressDetails,
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
            sortBy,
             search: searchQuery
        });
   } catch (error) {
    console.error("Admin Error:", error);
    res.render("admin/admin-error", { errorMessage: "Something went wrong. Please try again later." });
}

};




const renderOrderDetailsPage = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findOne({ orderId })
    .populate('user', 'name email')
    .populate('orderedItems.product')
    .populate('cancelledItems.product')
    .populate('returnedItems.product', 'productName productImage regularPrice salesPrice') 
    .lean();
    
if (!order) {
    console.error(`Admin: Order with orderId ${orderID} not found`);
    return res.status(404).render("admin/admin-error", {
        errorMessage: "Order not found. Please check the Order ID.",
    });
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
    console.error("Admin Error:", error);
    res.render("admin/admin-error", { errorMessage: "Something went wrong. Please try again later." });
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
        const { orderId, productId, status, denyReason } = req.body;

        console.log('Received verify return request:', { orderId, productId, status, denyReason });

        
        if (!orderId || (productId && !mongoose.isValidObjectId(productId))) {
            console.error('Invalid input:', { orderId, productId });
            return res.status(400).json({ error: 'Invalid order ID or product ID' });
        }
        if (!['Approved', 'Denied'].includes(status)) {
            console.error('Invalid status:', status);
            return res.status(400).json({ error: 'Invalid status' });
        }

        
        const order = await Order.findOne({ orderId })
            .populate('user', 'name email')
            .populate('orderedItems.product')
            .populate('returnedItems.product')
            .populate('cancelledItems.product');

        if (!order) {
            console.error('Order not found:', orderId);
            return res.status(404).json({ error: 'Order not found' });
        }

        let refundAmount = 0;

        if (productId) {
            
            const returnItemIndex = order.returnedItems.findIndex(item => item.product?._id?.toString() === productId);
            if (returnItemIndex === -1) {
                console.error('Returned item not found:', { productId, returnedItems: order.returnedItems });
                return res.status(404).json({ error: 'Returned item not found' });
            }

            const returnItem = order.returnedItems[returnItemIndex];
            if (returnItem.returnStatus !== 'Pending') {
                console.warn('Item return already processed:', { productId, currentStatus: returnItem.returnStatus });
                return res.status(400).json({ error: `Item return already ${returnItem.returnStatus.toLowerCase()}` });
            }

            if (status === 'Approved') {
                refundAmount = returnItem.price * returnItem.quantity;
                returnItem.returnStatus = 'Approved';
                returnItem.returnDate = new Date();
                order.refundedAmount = (order.refundedAmount || 0) + refundAmount;

                
                order.orderedItems = order.orderedItems.filter(item => item.product.toString() !== productId);

                
                if (returnItem.product?._id) {
                    await Product.findByIdAndUpdate(returnItem.product._id, {
                        $inc: { quantity: returnItem.quantity }
                    });
                    console.log(`Restocked product ${returnItem.product._id} by ${returnItem.quantity}`);
                }
            } else if (status === 'Denied') {
                returnItem.returnStatus = 'Denied';
                returnItem.returnDenyReason = denyReason || 'No reason provided';
                
            }

            
            if (order.returnedItems.every(item => item.returnStatus !== 'Pending')) {
                order.returnStatus = order.returnedItems.every(item => item.returnStatus === 'Approved') ? 'Approved' : 'Denied';
                order.status = order.returnedItems.every(item => item.returnStatus === 'Approved') ? 'Returned' : 'Return Denied';
                order.returnDate = order.returnedItems.every(item => item.returnStatus === 'Approved') ? new Date() : null;
                order.returnDenyReason = order.returnedItems.some(item => item.returnStatus === 'Denied') ? 'Some items denied' : null;
            }
        } else {
            
            if (order.status !== 'Return Request' || !order.returnRequested) {
                console.warn('Invalid whole-order return request:', {
                    orderId,
                    status: order.status,
                    returnRequested: order.returnRequested
                });
                return res.status(400).json({ error: 'No valid return request found for this order' });
            }

            if (status === 'Approved') {
                refundAmount = order.finalAmount;
                order.status = 'Returned';
                order.returnStatus = 'Approved';
                order.returnDate = new Date();
                order.refundedAmount = refundAmount;
                order.returnedItems.forEach(item => {
                    item.returnStatus = 'Approved';
                    item.returnDate = new Date();
                });

              
                order.orderedItems = [];

               
                for (const item of order.returnedItems) {
                    if (item.product?._id) {
                        await Product.findByIdAndUpdate(item.product._id, {
                            $inc: { quantity: item.quantity }
                        });
                        console.log(`Restocked product ${item.product._id} by ${item.quantity}`);
                    }
                }
            } else {
                order.status = 'Return Denied';
                order.returnStatus = 'Denied';
                order.returnDenyReason = denyReason || 'No reason provided';
                order.returnedItems.forEach(item => {
                    item.returnStatus = 'Denied';
                    item.returnDenyReason = denyReason || 'No reason provided';
                });
                
            }
        }

        
        if (status === 'Approved' && order.paymentStatus === 'Paid' && refundAmount > 0) {
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
                description: productId 
                    ? `Refund for item in order ${orderId}, product: ${order.returnedItems[returnItemIndex]?.product?.productName || 'Unknown Product'}`
                    : `Refund for order ${orderId}`,
                date: new Date()
            });

            await userWallet.save();
            console.log(`Refunded ₹${refundAmount} to wallet for order ${orderId}${productId ? `, product ${productId}` : ''}`);
        }

        await order.save();
        console.log(`Return request ${status.toLowerCase()} for order ${orderId}${productId ? `, product ${productId}` : ''}`);

        res.status(200).json({
            message: `Return request ${status.toLowerCase()} successfully`,
            refundAmount: refundAmount > 0 ? refundAmount : undefined
        });
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

