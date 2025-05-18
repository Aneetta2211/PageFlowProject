const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartschema');
const Order = require('../../models/orderSchema');
const Wallet = require('../../models/walletSchema'); 
const Coupon=require('../../models/couponSchema')
const { addToWallet } = require('./walletController');

// Validate Razorpay credentials at initialization
if (!process.env.RAZORPAY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('Razorpay credentials are missing. Please set RAZORPAY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    throw new Error('Razorpay credentials (RAZORPAY_ID or RAZORPAY_KEY_SECRET) are missing in environment variables');
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Helper function to generate sequential order ID in OR-XXXX format
const generateOrderId = async () => {
    try {
        const count = await Order.countDocuments();
        const newId = `OR-${String(count + 1).padStart(4, '0')}`; // e.g., OR-0001
        // Ensure the generated ID is unique
        const existingOrder = await Order.findOne({ orderId: newId });
        if (existingOrder) {
            // If ID exists, recursively try again (rare case)
            return await generateOrderId();
        }
        return newId;
    } catch (error) {
        console.error('Error generating order ID:', error);
        throw new Error('Failed to generate order ID');
    }
};

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

        console.log('Attempting to cancel order:', { orderID, userId: user._id, reason });

        // Validate orderID format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(orderID)) {
            console.warn('Invalid orderID format:', orderID);
            return res.status(400).json({ 
                success: false,
                error: 'Invalid order ID format' 
            });
        }

        // Find user's address document
        const addressDoc = await Address.findOne({ userId: user._id });
        if (!addressDoc) {
            console.warn('Address document not found for user:', user._id);
            return res.status(404).json({ 
                success: false,
                error: 'Address not found for user' 
            });
        }

        // Find order with matching orderId and address
        const order = await Order.findOne({ 
            orderId: orderID,
            address: { $in: addressDoc.address.map(addr => addr._id) }
        }).populate('orderedItems.product');

        if (!order) {
            console.warn('Order not found:', { orderID, userId: user._id, addressIds: addressDoc.address.map(addr => addr._id) });
            return res.status(404).json({ 
                success: false,
                error: 'Order not found or does not belong to user' 
            });
        }

        // Check order status
        if (['Cancelled', 'Delivered', 'Returned'].includes(order.status)) {
            console.log('Order cannot be cancelled:', { orderID, status: order.status });
            return res.status(400).json({ 
                success: false,
                error: `Order cannot be cancelled in ${order.status} state` 
            });
        }

        // Calculate refund amount
        const refundAmount = order.orderedItems.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);

        // Move all orderedItems to cancelledItems
        order.cancelledItems = order.cancelledItems || [];
        for (const item of order.orderedItems) {
            order.cancelledItems.push({
                product: item.product._id,
                quantity: item.quantity,
                price: item.price,
                cancelReason: reason || 'No reason provided',
                cancelledAt: new Date()
            });
            // Restore product stock
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { quantity: item.quantity }
            });
        }

        // Refund to wallet
        if (refundAmount > 0) {
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for cancelled order #${orderID}`
            });
            console.log(`Refunded ₹${refundAmount} to wallet for cancelled order ${orderID}`);
        }

        // Clear orderedItems and update order status
        order.orderedItems = [];
        order.status = 'Cancelled';
        order.cancelReason = reason || 'No reason provided';
        await order.save();

        console.log('Order cancelled successfully:', { orderID, cancelledItems: order.cancelledItems, refundAmount });

        res.json({ 
            success: true, 
            message: `Order cancelled successfully. ₹${refundAmount.toFixed(2)} refunded to wallet.`,
            orderId: order.orderId
        });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to cancel order',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const cancelOrderItem = async (req, res) => {
    try {
        const { orderID, productID } = req.params;
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
                error: `Cannot cancel items in ${order.status} state` 
            });
        }

        const itemIndex = order.orderedItems.findIndex(
            item => item.product._id.toString() === productID
        );

        if (itemIndex === -1) {
            return res.status(404).json({ error: 'Item not found in order' });
        }

        const item = order.orderedItems[itemIndex];
        const refundAmount = item.price * item.quantity;

        // Move item to cancelledItems
        order.cancelledItems = order.cancelledItems || [];
        order.cancelledItems.push({
            product: item.product._id,
            quantity: item.quantity,
            price: item.price,
            cancelReason: reason || 'No reason provided',
            cancelledAt: new Date()
        });

        // Remove item from orderedItems
        order.orderedItems.splice(itemIndex, 1);

        // Restore product stock
        await Product.findByIdAndUpdate(item.product._id, {
            $inc: { quantity: item.quantity }
        });

        // Recalculate totals
        order.totalPrice = order.orderedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        order.finalAmount = order.totalPrice - order.discount;

        // Refund to wallet
        if (refundAmount > 0) {
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for cancelled item in order #${orderID}`
            });
            console.log(`Refunded ₹${refundAmount} to wallet for cancelled item in order ${orderID}`);
        }

        // If no items remain, cancel the entire order
        if (order.orderedItems.length === 0) {
            order.status = 'Cancelled';
            order.cancelReason = reason || 'All items cancelled';
        }

        await order.save();

        res.json({ 
            success: true, 
            message: `Item cancelled successfully. ₹${refundAmount.toFixed(2)} refunded to wallet.`,
            orderId: order.orderId
        });
    } catch (error) {
        console.error('Error cancelling order item:', error);
        res.status(500).json({ 
            error: 'Failed to cancel item',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

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
        order.returnRequestDate = new Date();
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
                path: 'cancelledItems.product',
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

        if (order.cancelledItems && order.cancelledItems.length > 0) {
            doc.moveDown();
            doc.fontSize(14).text('Cancelled Items:');
            order.cancelledItems.forEach(item => {
                doc.text(`${item.product.productName} - ${item.quantity} x ₹${item.price.toFixed(2)} = ₹${(item.quantity * item.price).toFixed(2)} (Reason: ${item.cancelReason || 'No reason provided'})`);
            });
        }

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
            })
            .populate({
                path: 'cancelledItems.product',
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

        console.log('Cancelled Items:', order.cancelledItems.map(item => ({
            productId: item.product?._id,
            productName: item.product?.productName,
            productImage: item.product?.productImage,
            cancelReason: item.cancelReason
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
                address,
                cancelledItems: order.cancelledItems
            },
            user: req.user,
            currentPage: 'orders'
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', { message: 'Failed to load order details' });
    }
};

// const renderCheckout = async (req, res) => {
//     try {
//         const userId = req.user._id;

//         let cart = await Cart.findOne({ userId })
//             .populate({
//                 path: 'items.productId',
//                 populate: { path: 'category', model: 'category' },
//             });

//         if (!cart || cart.items.length === 0) {
//             return res.redirect(
//                 '/profile/cart?error=Your cart is empty. Add products before checkout.'
//             );
//         }

//         const invalidItems = cart.items.filter(
//             (item) =>
//                 !item.productId ||
//                 item.productId.quantity <= 0 ||
//                 item.productId.isBlocked ||
//                 (item.productId.category && !item.productId.category.isListed) ||
//                 item.productId.status !== 'Available'
//         );

//         cart.items = cart.items.filter(
//             (item) =>
//                 item.productId &&
//                 item.productId.quantity > 0 &&
//                 !item.productId.isBlocked &&
//                 !(item.productId.category && !item.productId.category.isListed) &&
//                 item.productId.status === 'Available'
//         );

//         if (cart.items.length === 0) {
//             let errorMessage = 'All items in your cart are unavailable. Please add valid items to proceed.';
//             if (invalidItems.some(item => item.productId && item.productId.quantity <= 0)) {
//                 errorMessage = 'All items in your cart are out of stock or unavailable. Please remove them and add valid items to proceed.';
//             }
//             return res.redirect(`/profile/cart?error=${encodeURIComponent(errorMessage)}`);
//         }

//         let subtotal = 0;
//         cart.items.forEach((item) => {
//             const price =
//                 item.productId.salesPrice > 0
//                     ? item.productId.salesPrice
//                     : item.productId.regularPrice;
//             subtotal += price * item.quantity;
//         });

//         const shipping = 0.00;
//         const discount = cart.discount || 0;
//         const total = subtotal - discount;

//         cart.subtotal = subtotal;
//         cart.shipping = shipping;
//         cart.discount = discount;
//         cart.taxes = 0.00;
//         cart.total = total;
//         await cart.save();

//         let addressDoc = await Address.findOne({ userId });
//         let addresses = addressDoc || { address: [] };

//         if (addresses.address.length > 0) {
//             addresses.address = addresses.address.sort((a, b) => {
//                 return b.isDefault - a.isDefault;
//             });
//         }

//         const warningMessage = invalidItems.length > 0
//             ? 'Some items in your cart are out of stock or unavailable and will be ignored during checkout. You may remove them from your cart.'
//             : null;

//         res.render('user/checkout', {
//             title: 'Checkout',
//             cart: {
//                 items: cart.items,
//                 subtotal,
//                 shipping,
//                 taxes: 0.00,
//                 discount,
//                 total,
//             },
//             addresses,
//             user: req.user,
//             currentPage: 'checkout',
//             success: req.query.success,
//             warning: warningMessage,
//             razorpayKeyId: process.env.RAZORPAY_ID // Pass Razorpay key_id to the template
//         });
//     } catch (error) {
//         console.error('Error rendering checkout:', error);
//         res.redirect('/profile/cart?error=Something went wrong. Please try again later.');
//     }
// };


const renderCheckout = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        console.log('renderCheckout: User ID from session:', userId); // Debug userId

        if (!userId) {
            return res.redirect('/login?error=Please log in to proceed to checkout');
        }

        const cart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                populate: { path: 'category', model: 'category' },
            });

        if (!cart || cart.items.length === 0) {
            return res.redirect(
                '/profile/cart?error=Your cart is empty. Add products before checkout.'
            );
        }

        const invalidItems = cart.items.filter(
            (item) =>
                !item.productId ||
                item.productId.quantity <= 0 ||
                item.productId.isBlocked ||
                (item.productId.category && !item.productId.category.isListed) ||
                item.productId.status !== 'Available'
        );

        cart.items = cart.items.filter(
            (item) =>
                item.productId &&
                item.productId.quantity > 0 &&
                !item.productId.isBlocked &&
                !(item.productId.category && !item.productId.category.isListed) &&
                item.productId.status === 'Available'
        );

        if (cart.items.length === 0) {
            let errorMessage = 'All items in your cart are unavailable. Please add valid items to proceed.';
            if (invalidItems.some(item => item.productId && item.productId.quantity <= 0)) {
                errorMessage = 'All items in your cart are out of stock or unavailable. Please remove them and add valid items to proceed.';
            }
            return res.redirect(`/profile/cart?error=${encodeURIComponent(errorMessage)}`);
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

        cart.subtotal = subtotal;
        cart.shipping = shipping;
        cart.discount = discount;
        cart.taxes = 0.00;
        cart.total = total;
        await cart.save();

        let addressDoc = await Address.findOne({ userId });
        let addresses = addressDoc || { address: [] };

        if (addresses.address.length > 0) {
            addresses.address = addresses.address.sort((a, b) => {
                return b.isDefault - a.isDefault;
            });
        }

        // Fetch all active, non-expired coupons
        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gte: new Date() }
        }).lean();

        console.log('renderCheckout: Fetched coupons:', coupons); // Debug raw coupons

        // Filter out coupons already used by the user
        const eligibleCoupons = coupons.filter(coupon => !coupon.usedBy.includes(userId));

        console.log('renderCheckout: Eligible coupons after filtering usedBy:', eligibleCoupons); // Debug filtered coupons

        // Calculate potential savings for each coupon and sort
        const sortedCoupons = eligibleCoupons.map(coupon => {
            let potentialSavings = 0;
            if (coupon.discountType === 'percentage') {
                potentialSavings = (subtotal * coupon.discount) / 100;
                if (coupon.maxDiscount > 0 && potentialSavings > coupon.maxDiscount) {
                    potentialSavings = coupon.maxDiscount;
                }
            } else {
                potentialSavings = coupon.discount;
            }
            return { ...coupon, potentialSavings };
        }).sort((a, b) => {
            if (b.potentialSavings !== a.potentialSavings) {
                return b.potentialSavings - a.potentialSavings;
            }
            return new Date(a.expiryDate) - new Date(b.expiryDate);
        });

        console.log('renderCheckout: Sorted coupons:', sortedCoupons); // Debug sorted coupons

        const warningMessage = invalidItems.length > 0
            ? 'Some items in your cart are out of stock or unavailable and will be ignored during checkout. You may remove them from your cart.'
            : null;

        res.render('user/checkout', {
            title: 'Checkout',
            cart: {
                items: cart.items,
                subtotal,
                shipping,
                taxes: 0.00,
                discount,
                total,
                appliedCoupon: cart.appliedCoupon
            },
            addresses,
            coupons: sortedCoupons,
            user: req.session.user,
            currentPage: 'checkout',
            success: req.query.success,
            warning: warningMessage,
            razorpayKeyId: process.env.RAZORPAY_ID
        });
    } catch (error) {
        console.error('Error rendering checkout:', error);
        res.redirect('/profile/cart?error=Something went wrong. Please try again later.');
    }
};

const placeOrder = async (req, res) => {
    try {
        const { selectedAddressId, paymentMethod, finalAmount } = req.body;
        const userId = req.session.user?.id; // Use session-based authentication

        if (!selectedAddressId) {
            return res.status(400).json({
                success: false,
                message: 'Address is required'
            });
        }

        if (!paymentMethod || !['COD', 'razorpay'].includes(paymentMethod)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment method'
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
        const calculatedFinalAmount = subtotal - discount;

        // Validate finalAmount from client
        if (Math.abs(calculatedFinalAmount - finalAmount) > 0.01) {
            return res.status(400).json({
                success: false,
                message: 'Invalid final amount'
            });
        }

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

        // Generate new order ID
        const orderId = await generateOrderId();

        const order = new Order({
            orderId,
            orderedItems,
            totalPrice: subtotal,
            discount,
            finalAmount: calculatedFinalAmount, // Use discounted amount
            address: selectedAddressId,
            user: userId,
            invoiceDate: new Date(),
            status: paymentMethod === 'COD' ? 'Placed' : 'Pending',
            paymentStatus: paymentMethod === 'COD' ? 'Paid' : 'Pending',
            createdOn: new Date(),
            paymentMethod,
            appliedCoupon: cart.appliedCoupon // Store applied coupon
        });

        await order.save();

        // Update product stock
        for (const item of validItems) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }

        // Clear cart
        cart.items = [];
        cart.subtotal = 0;
        cart.discount = 0;
        cart.total = 0;
        cart.appliedCoupon = null;
        await cart.save();

        if (paymentMethod === 'razorpay') {
            const shortOrderId = orderId.slice(0, 34);
            const receipt = `order_${shortOrderId}`;
            
            const razorpayOrder = await razorpay.orders.create({
                amount: calculatedFinalAmount * 100,
                currency: 'INR',
                receipt: receipt
            });

            return res.json({
                success: true,
                orderId: order.orderId,
                razorpayOrderId: razorpayOrder.id,
                message: 'Order created, proceed to payment'
            });
        }

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

const verifyPayment = async (req, res) => {
    try {
        const { orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
        const userId = req.user._id;

        console.log('Verifying payment for:', { orderId, razorpay_payment_id, razorpay_order_id });

        // Find the order
        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            console.warn('Order not found:', { orderId, userId });
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Validate Razorpay secret key
        if (!process.env.RAZORPAY_KEY_SECRET) {
            console.error('RAZORPAY_KEY_SECRET is not defined in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: Missing Razorpay secret key'
            });
        }

        // Verify payment signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            // Update order status and payment details
            order.paymentStatus = 'Paid';
            order.status = 'Placed'; // Set to 'Placed' to align with COD flow
            order.razorpayPaymentId = razorpay_payment_id;
            await order.save();

            console.log('Payment verified successfully:', {
                orderId,
                status: order.status,
                paymentStatus: order.paymentStatus
            });

            return res.json({
                success: true,
                message: 'Payment verified successfully',
                orderId: order.orderId
            });
        } else {
            console.warn('Invalid payment signature for order:', orderId);
            return res.json({
                success: false,
                message: 'Invalid payment signature'
            });
        }
    } catch (error) {
        console.error('Error verifying payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error during payment verification',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const paymentFailed = async (req, res) => {
    try {
        const { orderId, razorpay_order_id, razorpay_payment_id, error } = req.body;
        const userId = req.user._id;

        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        order.paymentStatus = 'Failed';
        order.razorpayPaymentId = razorpay_payment_id;
        order.paymentError = error.description || 'Payment failed';
        await order.save();

        return res.json({
            success: true,
            message: 'Payment failure recorded'
        });
    } catch (error) {
        console.error('Error recording payment failure:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while recording payment failure',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const retryPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        const userId = req.user._id;

        const order = await Order.findOne({ orderId, user: userId });
        if (!order || order.paymentStatus === 'Paid') {
            return res.status(400).json({
                success: false,
                message: 'Invalid or already paid order'
            });
        }

        // Truncate orderId to 34 chars and prefix with 'retry_' (6 chars) = 40 chars
        const shortOrderId = order.orderId.slice(0, 34);
        const receipt = `retry_${shortOrderId}`;
        console.log('Retry payment receipt:', receipt, 'Length:', receipt.length);

        const razorpayOrder = await razorpay.orders.create({
            amount: order.finalAmount * 100,
            currency: 'INR',
            receipt: receipt
        });

        return res.json({
            success: true,
            orderId: order.orderId,
            razorpayOrderId: razorpayOrder.id,
            amount: order.finalAmount,
            message: 'Retry payment initiated'
        });
    } catch (error) {
        console.error('Error initiating retry payment:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error while initiating retry payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// controllers/user/orderController.js

const applyCoupon = async (req, res) => {
  try {
    const { couponCode } = req.body;
    const userId = req.session.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User not authenticated" });
    }

    const cart = await Cart.findOne({ userId }).populate("items.productId");
    if (!cart) {
      return res.json({ success: false, message: "Cart not found" });
    }

    if (cart.appliedCoupon) {
      return res.json({ success: false, message: "A coupon is already applied" });
    }

    const coupon = await Coupon.findOne({
      code: { $regex: new RegExp(`^${couponCode.toUpperCase()}$`, "i") },
      isActive: true,
    });

    if (!coupon) {
      return res.json({ success: false, message: "Invalid or inactive coupon" });
    }

    if (coupon.expiryDate < new Date()) {
      return res.json({ success: false, message: "Coupon has expired" });
    }

    // Check usage limit for the user
    const userUsage = coupon.usage.find(entry => entry.userId.toString() === userId);
    if (userUsage && userUsage.usageCount >= 10) {
      return res.json({ success: false, message: "You have reached the maximum usage limit (10) for this coupon" });
    }

    const subtotal = cart.items.reduce((sum, item) => {
      const price = item.productId.salesPrice > 0 ? item.productId.salesPrice : item.productId.regularPrice;
      return sum + price * item.quantity;
    }, 0);

    if (subtotal < coupon.minPurchase) {
      return res.json({
        success: false,
        message: `Minimum purchase of ₹${coupon.minPurchase} required`,
      });
    }

    let discount = 0;
    if (coupon.discountType === "percentage") {
      discount = (subtotal * coupon.discount) / 100;
      if (coupon.maxDiscount > 0 && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.discount;
    }

    console.log('Applying coupon:', {
      couponCode,
      subtotal,
      discount,
      totalAfterDiscount: subtotal - discount
    });

    cart.subtotal = subtotal;
    cart.appliedCoupon = coupon.code;
    cart.discount = discount;
    cart.total = subtotal - discount;
    await cart.save();

    // Update coupon usage
    if (userUsage) {
      userUsage.usageCount += 1;
    } else {
      coupon.usage.push({ userId, usageCount: 1 });
    }
    await coupon.save();

    console.log('Cart updated:', {
      cartId: cart._id,
      subtotal: cart.subtotal,
      discount: cart.discount,
      total: cart.total,
      appliedCoupon: cart.appliedCoupon
    });
    console.log('Coupon usage updated:', {
      couponId: coupon._id,
      userId,
      usageCount: userUsage ? userUsage.usageCount : 1
    });

    res.json({
      success: true,
      message: `Coupon applied! You saved ₹${discount.toFixed(2)}`,
    });
  } catch (error) {
    console.error("Error applying coupon:", error);
    res.status(500).json({ success: false, message: "Error applying coupon" });
  }
};

const removeCoupon = async (req, res) => {
    try {
        const userId = req.session.user?.id; // Use session-based authentication
        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        const cart = await Cart.findOne({ userId }).populate("items.productId");
        if (!cart) {
            return res.json({ success: false, message: "Cart not found" });
        }

        const subtotal = cart.items.reduce((sum, item) => {
            const price = item.productId.salesPrice > 0 ? item.productId.salesPrice : item.productId.regularPrice;
            return sum + price * item.quantity;
        }, 0);

        cart.subtotal = subtotal;
        cart.appliedCoupon = null;
        cart.discount = 0;
        cart.total = subtotal;

        await cart.save();
        res.json({ success: true, message: "Coupon removed successfully" });
    } catch (error) {
        console.error("Error removing coupon:", error);
        res.status(500).json({ success: false, message: "Error removing coupon" });
    }
};

module.exports = {
    getOrdersPage,
    cancelOrder,
    cancelOrderItem, 
    returnOrder,
    downloadInvoice,
    getOrderDetails,
    renderCheckout,
    placeOrder,
    verifyPayment,
    paymentFailed,
    retryPayment,
    applyCoupon, 
    removeCoupon
};
