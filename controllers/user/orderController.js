const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartschema');
const Order = require('../../models/orderSchema');



const getOrdersPage = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).redirect('/login');
        }

        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 3; 
        const skip = (page - 1) * limit;

        
        const totalOrders = await Order.countDocuments({ user: user._id });

      
        const orders = await Order.find({ user: user._id })
            .populate({
                path: 'orderedItems.product',
                select: 'productName sku images regularPrice salesPrice'
            })
            .populate({
                path: 'address',
                select: 'address',
                populate: {
                    path: 'address',
                    match: { _id: { $eq: '$address' } }
                }
            })
            .sort({ createdOn: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        
        const totalPages = Math.ceil(totalOrders / limit);
        const hasPrev = page > 1;
        const hasNext = page < totalPages;

        
        const formattedOrders = orders.map(order => {
            const address = order.address && order.address.address && order.address.address.length > 0
                ? order.address.address[0]
                : {
                    name: 'N/A',
                    city: 'N/A',
                    landMark: 'N/A',
                    state: 'N/A',
                    pincode: 'N/A',
                    phone: 'N/A'
                };

            return {
                ...order,
                address
            };
        });

        res.render('user/orders', {
            orders: formattedOrders,
            user: req.user,
            currentPage: 'orders',
            pagination: {
                currentPage: page,
                totalPages,
                hasPrev,
                hasNext,
                prevPage: page > 1 ? page - 1 : null,
                nextPage: page < totalPages ? page + 1 : null,
                limit
            }
        });
    } catch (error) {
        console.error('Error in getOrdersPage:', error);
        res.status(500).render('error', {
            message: 'Failed to load orders',
            error: process.env.NODE_ENV === 'development' ? error : null
        });
    }
};




const cancelOrder = async (req, res) => {
    try {
        const { orderID } = req.params;
        const { reason } = req.body;
        const user = req.user;

        
        const addressDoc = await Address.findOne({ userId: user._id });
        if (!addressDoc) {
            return res.status(404).json({ error: 'Address not found' });
        }

        const order = await Order.findOne({ 
            orderId: orderID,
            address: { $in: addressDoc.address.map(addr => addr._id) }
        }).populate('orderedItems.product');

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (['Cancelled', 'Delivered', 'Returned'].includes(order.status)) {
            return res.status(400).json({ 
                error: `Order cannot be cancelled in ${order.status} state` 
            });
        }

       
        for (const item of order.orderedItems) {
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { quantity: item.quantity }
            });
        }

        order.status = 'Cancelled';
        order.cancelReason = reason || 'No reason provided';
        await order.save();

        res.json({ 
            success: true, 
            message: 'Order cancelled successfully',
            orderId: order.orderId
        });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ 
            error: 'Failed to cancel order',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// const returnOrder = async (req, res) => {
//     try {
//         const { orderID } = req.params;
//         const { reason } = req.body;
//         const user = req.user;

//         if (!reason) {
//             return res.status(400).json({ 
//                 error: 'Return reason is required' 
//             });
//         }

       
//         const addressDoc = await Address.findOne({ userId: user._id });
//         if (!addressDoc) {
//             return res.status(404).json({ error: 'Address not found' });
//         }

//         const order = await Order.findOne({ 
//             orderId: orderID,
//             address: { $in: addressDoc.address.map(addr => addr._id) }
//         }).populate('orderedItems.product');

//         if (!order) {
//             return res.status(404).json({ error: 'Order not found' });
//         }

//         if (order.status !== 'Delivered') {
//             return res.status(400).json({ 
//                 error: 'Only delivered orders can be returned' 
//             });
//         }

//         for (const item of order.orderedItems) {
//             await Product.findByIdAndUpdate(item.product._id, {
//                 $inc: { quantity: item.quantity }
//             });
//         }

//         order.status = 'Returned';
//         order.returnReason = reason;
//         await order.save();

//         res.json({ 
//             success: true, 
//             message: 'Return request submitted successfully',
//             orderId: order.orderId
//         });
//     } catch (error) {
//         console.error('Error processing return:', error);
//         res.status(500).json({ 
//             error: 'Failed to process return',
//             details: process.env.NODE_ENV === 'development' ? error.message : undefined
//         });
//     }
// };

const returnOrder = async (req, res) => {
    try {
        const { orderID } = req.params;
        const { reason } = req.body;
        const user = req.user;

        if (!reason) {
            return res.status(400).json({ 
                error: 'Return reason is required' 
            });
        }

        const addressDoc = await Address.findOne({ userId: user._id });
        if (!addressDoc) {
            return res.status(404).json({ error: 'Address not found' });
        }

        const order = await Order.findOne({ 
            orderId: orderID,
            address: { $in: addressDoc.address.map(addr => addr._id) }
        }).populate('orderedItems.product');

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        if (order.status !== 'Delivered') {
            return res.status(400).json({ 
                error: 'Only delivered orders can be returned' 
            });
        }

        order.status = 'Return Request';
        order.returnRequested = true;
        order.returnReason = reason;
        order.returnStatus = 'Pending';
        await order.save();

        console.log('Return request saved for order:', {
            orderId: order.orderId,
            returnRequested: order.returnRequested,
            returnStatus: order.returnStatus,
            returnReason: order.returnReason
        });

        res.json({ 
            success: true, 
            message: 'Return request submitted successfully',
            orderId: order.orderId
        });
    } catch (error) {
        console.error('Error processing return:', error);
        res.status(500).json({ 
            error: 'Failed to process return',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


const downloadInvoice = async (req, res) => {
    try {
        const { orderID } = req.params;
        const user = req.user;

        const order = await Order.findOne({ orderId: orderID, user: user._id })
            .populate({
                path: 'orderedItems.product',
                select: 'productName sku regularPrice salesPrice'
            })
            .populate({
                path: 'address',
                select: 'address',
                populate: {
                    path: 'address',
                    match: { _id: { $eq: '$address' } }
                }
            });

        if (!order) {
            return res.status(404).send('Order not found');
        }

       
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${order.orderId}.pdf`);
        doc.pipe(res);

       
        doc.fontSize(20).text('INVOICE', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Order ID: ${order.orderId}`);
        doc.text(`Date: ${order.createdOn.toDateString()}`);
        doc.text(`Status: ${order.status}`);

       
        const address = order.address && order.address.address && order.address.address.length > 0
            ? order.address.address[0]
            : null;
        if (address) {
            doc.moveDown();
            doc.text('Shipping Address:');
            doc.text(address.name);
            doc.text(address.landMark);
            doc.text(`${address.city}, ${address.state} ${address.pincode}`);
            doc.text(`Phone: ${address.phone}`);
            if (address.altPhone) {
                doc.text(`Alternate Phone: ${address.altPhone}`);
            }
        }

        
        doc.moveDown();
        doc.fontSize(14).text('Order Items:');
        order.orderedItems.forEach(item => {
            doc.text(`${item.product.productName} - ${item.quantity} x ₹${item.price.toFixed(2)} = ₹${(item.quantity * item.price).toFixed(2)}`);
        });

        doc.moveDown();
        doc.text(`Subtotal: ₹${order.totalPrice.toFixed(2)}`);
        doc.text(`Discount: ₹${order.discount.toFixed(2)}`);
        doc.text(`Total: ₹${order.finalAmount.toFixed(2)}`);
        doc.text(`Payment Method: ${order.paymentMethod || 'Not specified'}`);

        doc.end();
    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).send('Error generating invoice');
    }
};



const getOrderDetails = async (req, res) => {
    try {
        console.log("Fetching order details for order ID:", req.params.orderID);
        const { orderID } = req.params;
        const user = req.user;

        
        const order = await Order.findOne({ orderId: orderID, user: user._id })
            .populate({
                path: 'orderedItems.product',
                select: 'productName sku productImage regularPrice salesPrice'
            });

        if (!order) {
            console.log("Order not found for ID:", orderID);
            return res.status(404).render('error', { message: 'Order not found' });
        }

        
        console.log('Ordered Items:', order.orderedItems.map(item => ({
            productId: item.product?._id,
            productName: item.product?.productName,
            productImage: item.product?.productImage
        })));

        let address = null;
        if (order.address) {
            const addressDoc = await Address.findOne({
                userId: user._id,
                'address._id': order.address
            });
            if (addressDoc) {
                address = addressDoc.address.find(addr => addr._id.equals(order.address));
            }
        }

        console.log('Fetched Address:', address);

        res.render('user/orderDetails', {
            order: {
                ...order.toObject(),
                address // Pass the single address object
            },
            user: req.user,
            currentPage: 'orders'
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', { message: 'Failed to load order details' });
    }
};

const renderCheckout = async (req, res) => {
    try {
        const userId = req.user._id;

        let cart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                populate: { path: 'category', model: 'category' },
            });

        if (!cart || cart.items.length === 0) {
            return res.redirect(
                '/profile/cart?error=Your cart is empty. Add products before checkout.'
            );
        }

        // Filter invalid items
        cart.items = cart.items.filter(
            (item) =>
                item.productId &&
                item.productId.quantity > 0 &&
                !item.productId.isBlocked &&
                !(item.productId.category && !item.productId.category.isListed) &&
                item.productId.status === 'Available'
        );

        if (cart.items.length === 0) {
            return res.redirect(
                '/profile/cart?error=All items in your cart are unavailable. Please add valid items to proceed.'
            );
        }

        let subtotal = 0;
        cart.items.forEach((item) => {
            const price =
                item.productId.salesPrice > 0
                    ? item.productId.salesPrice
                    : item.productId.regularPrice;
            subtotal += price * item.quantity;
        });

        const shipping = 0.00;
        const discount = cart.discount || 0;
        const total = subtotal - discount;

        // Update cart
        cart.subtotal = subtotal;
        cart.shipping = shipping;
        cart.discount = discount;
        cart.taxes = 0.00;
        cart.total = total;
        await cart.save();

        let addressDoc = await Address.findOne({ userId });
        let addresses = addressDoc || { address: [] };

        // Sort addresses to put default address first
        if (addresses.address.length > 0) {
            addresses.address = addresses.address.sort((a, b) => {
                return b.isDefault - a.isDefault; // True (1) comes before False (0)
            });
        }

        res.render('user/checkout', {
            title: 'Checkout',
            cart: {
                items: cart.items,
                subtotal,
                shipping,
                taxes: 0.00,
                discount,
                total,
            },
            addresses,
            user: req.user,
            currentPage: 'checkout',
            success: req.query.success,
        });
    } catch (error) {
        console.error('Error rendering checkout:', error);
        res.redirect('/profile/cart?error=Something went wrong. Please try again later.');
    }
};

const placeOrder = async (req, res) => {
    try {
        const { selectedAddressId } = req.body;
        const userId = req.user._id;

        console.log('Selected Address ID:', selectedAddressId);

        if (!selectedAddressId) {
            return res.status(400).json({
                success: false,
                message: 'Address is required'
            });
        }

        const cart = await Cart.findOne({ userId }).populate({
            path: 'items.productId',
            select: '_id productName regularPrice salesPrice quantity status',
            populate: { path: 'category', select: 'isListed' }
        });

        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Your cart is empty'
            });
        }

        const validItems = cart.items.filter(item => {
            return item && 
                   item.productId && 
                   item.quantity > 0 &&
                   item.productId.quantity > 0 &&
                   item.productId.status === 'Available' &&
                   (!item.productId.category || item.productId.category.isListed);
        });

        if (validItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid items in cart'
            });
        }

        const subtotal = validItems.reduce((sum, item) => {
            const price = item.productId.salesPrice > 0 
                ? item.productId.salesPrice 
                : item.productId.regularPrice;
            return sum + (price * item.quantity);
        }, 0);

        const discount = cart.discount || 0;
        const finalAmount = subtotal - discount;

        const orderedItems = validItems.map(item => ({
            product: item.productId._id,
            quantity: item.quantity,
            price: item.productId.salesPrice > 0 
                ? item.productId.salesPrice 
                : item.productId.regularPrice
        }));

        const addressDoc = await Address.findOne({ 
            userId,
            'address._id': selectedAddressId
        });

        if (!addressDoc) {
            return res.status(400).json({
                success: false,
                message: 'Address not found'
            });
        }

        const order = new Order({
            orderId: require('uuid').v4(),
            orderedItems,
            totalPrice: subtotal,
            discount,
            finalAmount,
            address: selectedAddressId,
            user: userId,
            invoiceDate: new Date(),
            status: 'Pending',
            createdOn: new Date(),
            paymentMethod: 'Cash on Delivery' 
        });

        await order.save();
        console.log('Saved Order:', order);

        for (const item of validItems) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

        cart.items = [];
        cart.subtotal = 0;
        cart.discount = 0;
        cart.total = 0;
        await cart.save();

        res.json({
            success: true,
            orderId: order.orderId,
            message: 'Order placed successfully'
        });
    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while placing order',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
module.exports = {
    getOrdersPage,
    cancelOrder,
    returnOrder,
    downloadInvoice,
    getOrderDetails,
    renderCheckout,
    placeOrder,
};