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
const Coupon = require('../../models/couponSchema')
const { addToWallet } = require('./walletController');


if (!process.env.RAZORPAY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error('Razorpay credentials are missing. Please set RAZORPAY_ID and RAZORPAY_KEY_SECRET in environment variables.');
    throw new Error('Razorpay credentials (RAZORPAY_ID or RAZORPAY_KEY_SECRET) are missing in environment variables');
}

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


const generateOrderId = async (count = 0) => {
    try {

        const newId = `OR-${String(count + 1).padStart(4, '0')}`;
      

        const existingOrder = await Order.findOne({ orderId: newId });
        if (existingOrder) {
            count++
            return await generateOrderId(count)
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


        const orderIdRegex = /^OR-\d{4}$/;
        if (!orderIdRegex.test(orderID)) {
            console.warn('Invalid orderID format:', orderID);
            return res.status(400).json({
                success: false,
                error: 'Invalid order ID format'
            });
        }


        const order = await Order.findOne({
            orderId: orderID,
            user: user._id
        }).populate('orderedItems.product');

        if (!order) {
            console.warn('Order not found:', { orderID, userId: user._id });
            return res.status(404).json({
                success: false,
                error: 'Order not found or does not belong to user'
            });
        }


        if (['Cancelled', 'Delivered', 'Returned'].includes(order.status)) {
            console.log('Order cannot be cancelled:', { orderID, status: order.status });
            return res.status(400).json({
                success: false,
                error: `Order cannot be cancelled in ${order.status} state`
            });
        }


        const refundAmount = order.orderedItems.reduce((sum, item) => {
            const itemTotal = item.price * item.quantity;
            const itemDiscount = item.discountApplied || 0;
            return sum + (itemTotal - itemDiscount);
        }, 0) + (order.shipping || 0);

        order.cancelledItems = order.cancelledItems || [];
        for (const item of order.orderedItems) {
            order.cancelledItems.push({
                product: item.product._id,
                quantity: item.quantity,
                price: item.price,
                discountApplied: item.discountApplied || 0,
                cancelReason: reason || 'No reason provided',
                cancelledAt: new Date()
            });

            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { quantity: item.quantity }
            });
        }

        if (refundAmount > 0) {
            await addToWallet({
                userId: order.user,
                amount: refundAmount,
                description: `Refund for cancelled order #${orderID} (including shipping)`
            });
            console.log(`Refunded ₹${refundAmount.toFixed(2)} (including shipping) to wallet for cancelled order ${orderID}`);
        }


        order.orderedItems = [];
        order.status = 'Cancelled';
        order.cancelReason = reason || 'No reason provided';
        order.totalPrice = 0;
        order.discount = 0;
        order.finalAmount = 0;
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

        console.log('Attempting to cancel item:', { orderID, productID, userId: user._id, reason });


        if (!orderID || !productID) {
            console.warn('Missing orderID or productID:', { orderID, productID });
            return res.status(400).json({
                success: false,
                error: 'Order ID and Product ID are required'
            });
        }


        const orderIdRegex = /^OR-\d{4}$/;
        if (!orderIdRegex.test(orderID)) {
            console.warn('Invalid orderID format:', orderID);
            return res.status(400).json({
                success: false,
                error: 'Invalid order ID format'
            });
        }


        if (!mongoose.Types.ObjectId.isValid(productID)) {
            console.warn('Invalid productID format:', productID);
            return res.status(400).json({
                success: false,
                error: 'Invalid Product ID format'
            });
        }


        const order = await Order.findOne({
            orderId: orderID,
            user: user._id
        }).populate('orderedItems.product');

        if (!order) {
            console.warn('Order not found:', { orderID, userId: user._id });
            return res.status(404).json({
                success: false,
                error: 'Order not found or does not belong to user'
            });
        }

        console.log('Order found:', { orderId: order.orderId, status: order.status, itemCount: order.orderedItems.length });


        if (['Cancelled', 'Delivered', 'Returned'].includes(order.status)) {
            console.log('Cannot cancel items in order:', { orderID, status: order.status });
            return res.status(400).json({
                success: false,
                error: `Cannot cancel items in ${order.status} state`
            });
        }

        const itemIndex = order.orderedItems.findIndex(
            item => item.product && item.product._id.toString() === productID
        );

        if (itemIndex === -1) {
            console.warn('Item not found in order:', { orderID, productID });
            return res.status(404).json({
                success: false,
                error: 'Item not found in order'
            });
        }

        const item = order.orderedItems[itemIndex];
        const itemTotal = item.price * item.quantity;
        const itemDiscount = item.discountApplied || 0;
        const refundAmount = (itemTotal - itemDiscount) + (order.orderedItems.length === 1 ? (order.shipping || 0) : 0);



        console.log('Item to cancel:', { productID, quantity: item.quantity, price: item.price, discountApplied: itemDiscount, refundAmount });


        order.cancelledItems = order.cancelledItems || [];
        order.cancelledItems.push({
            product: item.product._id,
            quantity: item.quantity,
            price: item.price,
            discountApplied: itemDiscount,
            cancelReason: reason || 'No reason provided',
            cancelledAt: new Date()
        });


        order.orderedItems.splice(itemIndex, 1);


        const productUpdate = await Product.findByIdAndUpdate(item.product._id, {
            $inc: { quantity: item.quantity }
        }, { new: true });

        if (!productUpdate) {
            console.warn('Product not found for stock update:', item.product._id);
            return res.status(404).json({
                success: false,
                error: 'Product not found for stock update'
            });
        }


        order.totalPrice = order.orderedItems.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);


        const originalItemTotal = itemTotal - itemDiscount;
        const originalTotalPrice = order.totalPrice + originalItemTotal;
        const discountFactor = order.discount && originalTotalPrice > 0 ? order.discount / originalTotalPrice : 0;
        order.discount = order.totalPrice * discountFactor;
        order.finalAmount = order.totalPrice - order.discount;


        if (order.orderedItems.length > 0 && discountFactor > 0) {
            order.orderedItems.forEach(item => {
                const itemTotal = item.price * item.quantity;
                item.discountApplied = itemTotal * discountFactor;
            });
        } else {
            order.orderedItems.forEach(item => {
                item.discountApplied = 0;
            });
        }

        if (refundAmount > 0) {
            try {
                await addToWallet({
                    userId: order.user,
                    amount: refundAmount,
                    description: `Refund for cancelled item in order #${orderID}${order.orderedItems.length === 0 ? ' (including shipping)' : ''}`
                });
                console.log(`Refunded ₹${refundAmount.toFixed(2)}${order.orderedItems.length === 0 ? ' (including shipping)' : ''} to wallet for cancelled item in order ${orderID}`);
            } catch (walletError) {
                console.error('Error adding to wallet:', walletError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to process refund to wallet'
                });
            }
        }


        if (order.orderedItems.length === 0) {
            order.status = 'Cancelled';
            order.cancelReason = reason || 'All items cancelled';
            order.totalPrice = 0;
            order.discount = 0;
            order.finalAmount = 0;
        }

        await order.save();

        console.log('Item cancelled successfully:', {
            orderID,
            productID,
            refundAmount: refundAmount.toFixed(2),
            newTotalPrice: order.totalPrice,
            newDiscount: order.discount,
            newFinalAmount: order.finalAmount
        });

        return res.status(200).json({
            success: true,
            message: `Item cancelled successfully. ₹${refundAmount.toFixed(2)} refunded to wallet.`,
            orderId: order.orderId
        });
    } catch (error) {
        console.error('Error cancelling order item:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to cancel item',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};
const returnOrder = async (req, res) => {
    try {
        const { orderID } = req.params;
        const { reason } = req.body;
        const user = req.user;


        const orderIdRegex = /^OR-\d{4}$/;
        if (!orderIdRegex.test(orderID)) {
            console.warn('Invalid orderID format:', orderID);
            return res.status(400).json({
                success: false,
                error: 'Invalid order ID format'
            });
        }

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

        // Validate order ID format
        const orderIdRegex = /^OR-\d{4}$/;
        if (!orderIdRegex.test(orderID)) {
            console.warn('Invalid orderID format:', orderID);
            return res.status(400).json({
                success: false,
                error: 'Invalid order ID format'
            });
        }

        const order = await Order.findOne({ orderId: orderID, user: user._id })
            .populate({
                path: 'orderedItems.product',
                select: 'productName regularPrice salesPrice'
            })
            .populate({
                path: 'cancelledItems.product',
                select: 'productName regularPrice salesPrice'
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

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${order.orderId}.pdf`);
        doc.pipe(res);


        doc.fontSize(24).fillColor('#2c3e50').text('INVOICE', { align: 'center' });
        doc.moveDown(0.5);


        doc.fontSize(12).fillColor('#7f8c8d')
            .text('PAGEFLOW', { align: 'center' })
            .text('123 Book Street, Literature City, LC 12345', { align: 'center' })
            .text('Phone: +1 (123) 456-7890| Email: pageflow@gmail.com', { align: 'center' });

        doc.moveDown(1);


        doc.strokeColor('#bdc3c7').lineWidth(1)
            .moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);


        const leftColumn = 50;
        const rightColumn = 350;

        doc.fontSize(14).fillColor('#2c3e50').text('Invoice Details:', leftColumn, doc.y);
        doc.fontSize(11).fillColor('#34495e')
            .text(`Invoice Number: ${order.orderId}`, leftColumn, doc.y + 20)
            .text(`Order Date: ${order.createdOn.toLocaleDateString('en-IN')}`, leftColumn, doc.y + 15)
            .text(`Status: ${order.status}`, leftColumn, doc.y + 15)
            .text(`Payment Method: ${order.paymentMethod || 'Not specified'}`, leftColumn, doc.y + 15);


        const address = order.address && order.address.address && order.address.address.length > 0
            ? order.address.address[0]
            : null;

        if (address) {
            doc.fontSize(14).fillColor('#2c3e50').text('Billing Address:', rightColumn, doc.y - 80);
            doc.fontSize(11).fillColor('#34495e')
                .text(address.name || 'N/A', rightColumn, doc.y + 20)
                .text(address.landMark || 'N/A', rightColumn, doc.y + 15)
                .text(`${address.city || 'N/A'}, ${address.state || 'N/A'} ${address.pincode || 'N/A'}`, rightColumn, doc.y + 15)
                .text(`Phone: ${address.phone || 'N/A'}`, rightColumn, doc.y + 15);
            if (address.altPhone) {
                doc.text(`Alt Phone: ${address.altPhone}`, rightColumn, doc.y + 15);
            }
        }

        doc.moveDown(2);


        doc.fontSize(14).fillColor('#2c3e50').text('Order Items:', leftColumn, doc.y);
        doc.moveDown(0.5);


        const tableTop = doc.y;
        const itemHeight = 25;


        const columns = {
            item: { x: leftColumn, width: 250 },
            qty: { x: leftColumn + 250, width: 60 },
            price: { x: leftColumn + 310, width: 80 },
            discount: { x: leftColumn + 390, width: 80 },
            total: { x: leftColumn + 470, width: 80 }
        };


        doc.rect(leftColumn, tableTop, 500, itemHeight).fillAndStroke('#ecf0f1', '#bdc3c7');

        doc.fontSize(10).fillColor('#2c3e50')
            .text('Item', columns.item.x + 5, tableTop + 8)
            .text('Qty', columns.qty.x + 5, tableTop + 8)
            .text('Price', columns.price.x + 5, tableTop + 8)
            .text('Discount', columns.discount.x + 5, tableTop + 8)
            .text('Total', columns.total.x + 5, tableTop + 8);

        let currentY = tableTop + itemHeight;


        if (order.orderedItems && order.orderedItems.length > 0) {
            order.orderedItems.forEach((item, index) => {
                const isEven = index % 2 === 0;
                const rowColor = isEven ? '#ffffff' : '#f8f9fa';


                doc.rect(leftColumn, currentY, 500, itemHeight).fillAndStroke(rowColor, '#ecf0f1');

                const itemTotal = item.quantity * item.price;
                const discountAmount = item.discountApplied || 0;
                const finalTotal = itemTotal - discountAmount;

                doc.fontSize(9).fillColor('#2c3e50')
                    .text(item.product.productName || 'N/A', columns.item.x + 5, currentY + 8, { width: columns.item.width - 10 })
                    .text(item.quantity.toString(), columns.qty.x + 5, currentY + 8)
                    .text(`₹${item.price.toFixed(2)}`, columns.price.x + 5, currentY + 8)
                    .text(`₹${discountAmount.toFixed(2)}`, columns.discount.x + 5, currentY + 8)
                    .text(`₹${finalTotal.toFixed(2)}`, columns.total.x + 5, currentY + 8);

                currentY += itemHeight;
            });
        }


        if (order.cancelledItems && order.cancelledItems.length > 0) {
            doc.moveDown(1);
            doc.fontSize(12).fillColor('#e74c3c').text('Cancelled Items:', leftColumn, currentY + 10);
            currentY += 35;


            doc.rect(leftColumn, currentY, 500, itemHeight).fillAndStroke('#ffebee', '#ef5350');

            doc.fontSize(10).fillColor('#c62828')
                .text('Item', columns.item.x + 5, currentY + 8)
                .text('Qty', columns.qty.x + 5, currentY + 8)
                .text('Price', columns.price.x + 5, currentY + 8)
                .text('Reason', columns.discount.x + 5, currentY + 8, { width: 160 });

            currentY += itemHeight;

            order.cancelledItems.forEach((item, index) => {
                const isEven = index % 2 === 0;
                const rowColor = isEven ? '#fff5f5' : '#ffebee';

                doc.rect(leftColumn, currentY, 500, itemHeight).fillAndStroke(rowColor, '#ffcdd2');

                doc.fontSize(9).fillColor('#c62828')
                    .text(item.product.productName || 'N/A', columns.item.x + 5, currentY + 8, { width: columns.item.width - 10 })
                    .text(item.quantity.toString(), columns.qty.x + 5, currentY + 8)
                    .text(`₹${item.price.toFixed(2)}`, columns.price.x + 5, currentY + 8)
                    .text(item.cancelReason || 'No reason', columns.discount.x + 5, currentY + 8, { width: 160 });

                currentY += itemHeight;
            });
        }


        doc.moveDown(2);


        const totalsStartY = Math.max(currentY + 20, doc.y);
        const totalsX = 350;


        doc.rect(totalsX, totalsStartY, 200, 120).fillAndStroke('#f8f9fa', '#dee2e6');

        doc.fontSize(12).fillColor('#2c3e50')
            .text('Order Summary', totalsX + 10, totalsStartY + 10);

        doc.fontSize(10).fillColor('#495057')
            .text(`Subtotal: ₹${order.totalPrice.toFixed(2)}`, totalsX + 10, totalsStartY + 35)
            .text(`Shipping: ₹${order.shipping ? order.shipping.toFixed(2) : '0.00'}`, totalsX + 10, totalsStartY + 50)
            .text(`Discount: ₹${order.discount.toFixed(2)}`, totalsX + 10, totalsStartY + 65);


        doc.fontSize(12).fillColor('#2c3e50')
            .text(`Total: ₹${order.finalAmount.toFixed(2)}`, totalsX + 10, totalsStartY + 85);


        doc.fontSize(8).fillColor('#7f8c8d')
            .text('Thank you for your business!', 50, doc.page.height - 100, { align: 'center' })
            .text('This is a computer generated invoice.', 50, doc.page.height - 85, { align: 'center' });

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
                select: 'productName sku productImage regularPrice salesPrice',
                match: { isBlocked: { $ne: true } }
            })
            .populate({
                path: 'cancelledItems.product',
                select: 'productName sku productImage regularPrice salesPrice',
                match: { isBlocked: { $ne: true } }
            });

        if (!order) {
            console.log("Order not found for ID:", orderID);
            return res.status(404).render('error', { message: 'Order not found' });
        }


        console.log('Ordered Items:', order.orderedItems.map(item => ({
            productId: item.product?._id,
            productName: item.product?.productName || 'Not populated',
            productImage: item.product?.productImage || 'Not populated'
        })));

        console.log('Cancelled Items:', order.cancelledItems.map(item => ({
            productId: item.product?._id,
            productName: item.product?.productName || 'Not populated',
            productImage: item.product?.productImage || 'Not populated',
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




const renderCheckout = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        console.log("renderCheckout: User ID from session:", userId);

        if (!userId) {
            console.log("renderCheckout: No user ID in session, redirecting to login");
            return res.redirect("/login?error=Please log in to proceed to checkout");
        }

        const cart = await Cart.findOne({ userId }).populate({
            path: "items.productId",
            populate: { path: "category", model: "category" },
        });

        if (!cart || cart.items.length === 0) {
            console.log("renderCheckout: Cart is empty or not found, redirecting to cart");
            return res.redirect(
                "/profile/cart?error=Your cart is empty. Add products before checkout."
            );
        }

        const invalidItems = cart.items.filter(
            (item) =>
                !item.productId ||
                item.productId.quantity <= 0 ||
                item.productId.isBlocked ||
                (item.productId.category && !item.productId.category.isListed) ||
                item.productId.status !== "Available"
        );

        cart.items = cart.items.filter(
            (item) =>
                item.productId &&
                item.productId.quantity > 0 &&
                !item.productId.isBlocked &&
                !(item.productId.category && !item.productId.category.isListed) &&
                item.productId.status === "Available"
        );

        if (cart.items.length === 0) {
            let errorMessage =
                "All items in your cart are unavailable. Please add valid items to proceed.";
            if (invalidItems.some((item) => item.productId && item.productId.quantity <= 0)) {
                errorMessage =
                    "All items in your cart are out of stock or unavailable. Please remove them and add valid items to proceed.";
            }
            console.log("renderCheckout: No valid items in cart, redirecting:", errorMessage);
            return res.redirect(`/profile/cart?error=${encodeURIComponent(errorMessage)}`);
        }

        let subtotal = 0;
        const cartProductIds = cart.items.map((item) => item.productId._id.toString());
        cart.items.forEach((item) => {
            const price =
                item.productId.salesPrice > 0
                    ? item.productId.salesPrice
                    : item.productId.regularPrice;
            subtotal += price * item.quantity;
        });

        const shipping = 49.00;
        const discount = cart.discount || 0;
        const total = cart.total !== undefined && cart.total !== null ? cart.total : subtotal + shipping - discount;

        if (
            cart.subtotal !== subtotal ||
            cart.discount !== discount ||
            cart.total !== total ||
            cart.shipping !== shipping
        ) {
            cart.subtotal = subtotal;
            cart.discount = discount;
            cart.shipping = shipping;
            cart.taxes = 0.00;
            cart.total = total;
            await cart.save();
            console.log("renderCheckout: Updated cart:", { subtotal, shipping, discount, total });
        }

        let addressDoc = await Address.findOne({ userId });
        let addresses = addressDoc || { address: [] };

        if (addresses.address.length > 0) {
            addresses.address = addresses.address.sort((a, b) => {
                return b.isDefault - a.isDefault;
            });
        }

        const coupons = await Coupon.find({
            isActive: true,
            expiryDate: { $gte: new Date() },
        }).lean();
        console.log("renderCheckout: All coupons fetched:", coupons.length, coupons.map(c => c.code));

        const couponsWithStatus = coupons.map((coupon) => {
            const userUsage = coupon.usage.filter(
                (entry) => entry.userId && entry.userId.toString() === userId.toString()
            );
            const totalUserUsage = userUsage.reduce((sum, entry) => sum + (entry.usageCount || 1), 0);
            const maxUsagePerUser = coupon.maxUsagePerUser || 10;
            const usageLimitReached = totalUserUsage >= maxUsagePerUser;
            const usedForCartProducts = userUsage.some((entry) =>
                entry.productId && cartProductIds.includes(entry.productId.toString())
            );
            const meetsMinPurchase = coupon.minPurchase <= subtotal;

            let potentialSavings = 0;
            if (coupon.discountType === "percentage") {
                potentialSavings = (subtotal * coupon.discount) / 100;
                if (coupon.maxDiscount > 0 && potentialSavings > coupon.maxDiscount) {
                    potentialSavings = coupon.maxDiscount;
                }
            } else {
                potentialSavings = coupon.discount;
            }

            const isEligible = !usageLimitReached && !usedForCartProducts && meetsMinPurchase && (!cart.appliedCoupon || cart.appliedCoupon === coupon.code);

            console.log(`renderCheckout: Coupon ${coupon.code} eligibility:`, {
                totalUserUsage,
                maxUsagePerUser,
                usedForCartProducts,
                meetsMinPurchase,
                minPurchase: coupon.minPurchase,
                subtotal,
                isEligible
            });

            return {
                ...coupon,
                potentialSavings,
                isEligible,
                ineligibilityReason: !isEligible ? (
                    usageLimitReached ? "Maximum usage limit reached" :
                        usedForCartProducts ? "Already used for products in cart" :
                            !meetsMinPurchase ? `Minimum purchase of ₹${coupon.minPurchase} required` :
                                cart.appliedCoupon ? "Another coupon is already applied" : "Unknown reason"
                ) : null
            };
        });

        const sortedCoupons = couponsWithStatus.sort((a, b) => {
            if (a.isEligible !== b.isEligible) {
                return b.isEligible - a.isEligible;
            }
            if (b.potentialSavings !== a.potentialSavings) {
                return b.potentialSavings - a.potentialSavings;
            }
            return new Date(a.expiryDate) - new Date(b.expiryDate);
        });

        console.log("renderCheckout: Sorted coupons with eligibility:", sortedCoupons.map(c => ({
            code: c.code,
            isEligible: c.isEligible,
            ineligibilityReason: c.ineligibilityReason
        })));


        const wallet = await Wallet.findOne({ user: userId });
        const walletBalance = wallet ? wallet.balance : 0;

        const warningMessage =
            invalidItems.length > 0
                ? "Some items in your cart are out of stock or unavailable and will be ignored during checkout. You may remove them from your cart."
                : null;

        console.log("renderCheckout: Rendering checkout with cart values:", {
            subtotal: cart.subtotal,
            shipping: cart.shipping,
            discount: cart.discount,
            total: cart.total,
            appliedCoupon: cart.appliedCoupon,
            couponCount: sortedCoupons.length,
            walletBalance
        });

        res.render("user/checkout", {
            title: "Checkout",
            cart: {
                items: cart.items,
                subtotal,
                shipping,
                taxes: 0.00,
                discount: cart.discount || 0,
                total: cart.total,
                appliedCoupon: cart.appliedCoupon,
            },
            addresses,
            coupons: sortedCoupons,
            user: req.session.user,
            currentPage: "checkout",
            success: req.query.success,
            warning: warningMessage,
            razorpayKeyId: process.env.RAZORPAY_ID,
            walletBalance
        });
    } catch (error) {
        console.error("renderCheckout: Error rendering checkout:", error);
        res.redirect(
            "/profile/cart?error=Something went wrong. Please try again later."
        );
    }
};

const placeOrder = async (req, res) => {
    try {

        const { selectedAddressId, paymentMethod, finalAmount } = req.body;
        const userId = req.session.user?.id;

        if (!selectedAddressId) {
            return res.status(400).json({
                success: false,
                message: 'Address is required'
            });
        }

        if (!paymentMethod || !['COD', 'razorpay', 'wallet'].includes(paymentMethod)) {
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


        const shipping = 49.00;
        const discount = cart.discount || 0;
        const calculatedFinalAmount = subtotal + shipping - discount;
        console.log("calculatedFinalAmount", calculatedFinalAmount)


        if (Math.abs(calculatedFinalAmount - finalAmount) > 0.01) {
            return res.status(400).json({
                success: false,
                message: 'Invalid final amount'
            });
        }



        if (paymentMethod === 'COD' && calculatedFinalAmount > 1000) {
            return res.status(400).json({
                success: false,
                message: 'Cash on Delivery is not available for orders above ₹1000'
            });
        }


        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            const walletBalance = wallet ? wallet.balance : 0;

            if (walletBalance < calculatedFinalAmount) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient wallet balance'
                });
            }


            await addToWallet({
                userId,
                amount: calculatedFinalAmount,
                description: `Payment for order #${await generateOrderId()}`,
                type: 'debit'
            });
        }


        const discountFactor = discount && subtotal > 0 ? discount / subtotal : 0;
        const orderedItems = validItems.map(item => {
            const price = item.productId.salesPrice > 0
                ? item.productId.salesPrice
                : item.productId.regularPrice;
            const itemTotal = price * item.quantity;
            const itemDiscount = itemTotal * discountFactor;
            return {
                product: item.productId._id,
                quantity: item.quantity,
                price: price,
                discountApplied: itemDiscount
            };
        });

        const addressDoc = await Address.findOne({
            userId,
            'address._id': selectedAddressId
        });



        if (!addressDoc) {
            console.log("jaiiiiii")
            return res.status(400).json({
                success: false,
                message: 'Address not found'
            });
        }


        const orderId = await generateOrderId();
        console.log("orderId", orderId)

        const order = new Order({
            orderId,
            orderedItems,
            totalPrice: subtotal,
            shipping,
            discount,
            finalAmount: calculatedFinalAmount,
            address: selectedAddressId,
            user: userId,
            invoiceDate: new Date(),
            status: paymentMethod === 'COD' || paymentMethod === 'wallet' ? 'Placed' : 'Pending',
            paymentStatus: paymentMethod === 'COD' || paymentMethod === 'wallet' ? 'Paid' : 'Pending',
            createdOn: new Date(),
            paymentMethod,
            appliedCoupon: cart.appliedCoupon,
            couponApplied: !!cart.appliedCoupon
        });

        await order.save();


        if (cart.appliedCoupon) {
            const coupon = await Coupon.findOne({ code: cart.appliedCoupon, isActive: true });
            if (coupon) {
                validItems.forEach((item) => {
                    const existingUsage = coupon.usage.find(
                        (entry) =>
                            entry.userId &&
                            entry.userId.toString() === userId.toString() &&
                            entry.productId &&
                            entry.productId.toString() === item.productId._id.toString()
                    );
                    if (existingUsage) {
                        existingUsage.usageCount += 1;
                    } else {
                        coupon.usage.push({
                            userId,
                            productId: item.productId._id,
                            usageCount: 1,
                        });
                    }
                });
                await coupon.save();
            }
        }


        for (const item of validItems) {
            await Product.findByIdAndUpdate(item.productId._id, {
                $inc: { quantity: -item.quantity }
            });
        }


        cart.items = [];
        cart.subtotal = 0;
        cart.discount = 0;
        cart.shipping = 0;
        cart.total = 0;
        cart.appliedCoupon = null;
        await cart.save();

        if (paymentMethod === 'razorpay') {
            const shortOrderId = orderId.slice(0, 34);
            const receipt = `order_${shortOrderId}`;

            const razorpayOrder = await razorpay.orders.create({
                amount: Math.round(calculatedFinalAmount * 100),
                currency: 'INR',
                receipt: receipt
            });

            return res.json({
                success: true,
                orderId: order.orderId,
                razorpayOrderId: razorpayOrder.id,
                amount: calculatedFinalAmount,
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


        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            console.warn('Order not found:', { orderId, userId });
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }


        if (!process.env.RAZORPAY_KEY_SECRET) {
            console.error('RAZORPAY_KEY_SECRET is not defined in environment variables');
            return res.status(500).json({
                success: false,
                message: 'Server configuration error: Missing Razorpay secret key'
            });
        }


        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature === razorpay_signature) {

            order.paymentStatus = 'Paid';
            order.status = 'Placed';
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

        console.log('Recording payment failure for:', { orderId, razorpay_order_id, razorpay_payment_id });

        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            console.warn('Order not found:', { orderId, userId });
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        order.paymentStatus = 'Failed';
        order.status = 'Payment Failed'; // Set status to "Payment Failed"
        order.razorpayPaymentId = razorpay_payment_id;
        order.paymentError = error.description || 'Payment failed';
        await order.save();

        console.log('Payment failure recorded:', {
            orderId,
            status: order.status,
            paymentStatus: order.paymentStatus,
            paymentError: order.paymentError
        });

        return res.json({
            success: true,
            message: 'Payment failure recorded'
        });
    } catch (error) {
        console.error('Error recording payment failure:', error);
        return res.status(500).json({
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

        console.log('Initiating retry payment for:', { orderId, userId });

        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            console.warn('Order not found:', { orderId, userId });
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        if (order.paymentStatus === 'Paid') {
            console.warn('Order already paid:', { orderId });
            return res.status(400).json({
                success: false,
                message: 'Order is already paid'
            });
        }

        if (order.status !== 'Payment Failed') { // Check for "Payment Failed" status
            console.warn('Order not in retryable state:', { orderId, status: order.status });
            return res.status(400).json({
                success: false,
                message: 'Order is not in a retryable state'
            });
        }

        const receipt = `retry_${order.orderId}`;
        const razorpayOrder = await razorpay.orders.create({
            amount: Math.round(order.finalAmount * 100),
            currency: 'INR',
            receipt: receipt
        });

        console.log('Razorpay order created for retry:', { razorpayOrderId: razorpayOrder.id, receipt });

        return res.json({
            success: true,
            orderId: order.orderId,
            razorpayOrderId: razorpayOrder.id,
            amount: order.finalAmount,
            message: 'Retry payment initiated'
        });
    } catch (error) {
        console.error('Error initiating retry payment:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error while initiating retry payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const applyCoupon = async (req, res) => {
    try {
        const { couponCode } = req.body;
        const userId = req.session.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Please log in to apply a coupon" });
        }

        const cart = await Cart.findOne({ userId }).populate("items.productId");
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty" });
        }

        if (cart.appliedCoupon) {
            return res.status(400).json({
                success: false,
                message: "A coupon is already applied. Remove it to apply a new one.",
            });
        }

        const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
        if (!coupon || coupon.expiryDate < new Date()) {
            return res.status(400).json({ success: false, message: "Invalid or expired coupon" });
        }


        let subtotal = 0;
        const validCartItems = cart.items.filter((item) => item.productId && item.productId._id);
        if (validCartItems.length === 0) {
            return res.status(400).json({ success: false, message: "No valid products in cart" });
        }
        const cartProductIds = validCartItems.map((item) => item.productId._id.toString());
        for (const item of validCartItems) {
            const product = item.productId;
            const price = product.salesPrice > 0 ? product.salesPrice : product.regularPrice;
            subtotal += price * item.quantity;
        }

        if (subtotal < coupon.minPurchase) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase of ₹${coupon.minPurchase} required for this coupon`,
            });
        }


        const userUsage = coupon.usage.filter(
            (entry) => entry.userId && entry.userId.toString() === userId.toString()
        );
        const totalUserUsage = userUsage.reduce((sum, entry) => sum + (entry.usageCount || 1), 0);
        const maxUsagePerUser = coupon.maxUsagePerUser || 10;
        if (totalUserUsage >= maxUsagePerUser) {
            return res.status(400).json({
                success: false,
                message: "You have reached the maximum usage limit for this coupon",
            });
        }


        const usedForCartProducts = userUsage.some((entry) =>
            entry.productId && cartProductIds.includes(entry.productId.toString())
        );
        if (usedForCartProducts) {
            return res.status(400).json({
                success: false,
                message: "This coupon has already been used for one or more products in your cart",
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


        cart.subtotal = subtotal;
        cart.discount = discount;
        cart.shipping = 49.00;
        cart.total = subtotal + cart.shipping - discount;
        cart.appliedCoupon = coupon.code;

        await cart.save();

        return res.json({
            success: true,
            message: `Coupon applied! You saved ₹${discount.toFixed(2)}`,
            discount,
        });
    } catch (error) {
        console.error("Error applying coupon:", error);
        return res.status(500).json({ success: false, message: "Failed to apply coupon" });
    }
};

const removeCoupon = async (req, res) => {
    try {
        const userId = req.session.user?.id;
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
