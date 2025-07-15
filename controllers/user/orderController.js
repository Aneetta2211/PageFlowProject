const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../../models/userSchema');
const Address = require('../../models/addressSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Cart = require('../../models/cartSchema');
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
            console.log("No user found, redirecting to login");
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

        // Log orders to verify orderId presence
        console.log("Fetched orders:", orders.map(o => ({
            orderId: o.orderId,
            status: o.status,
            createdOn: o.createdOn
        })));

        const totalPages = Math.ceil(totalOrders / limit);
        const hasPrev = page > 1;
        const hasNext = page < totalPages;

        const formattedOrders = orders.map(order => {
            if (!order.orderId) {
                console.warn("Order missing orderId:", order);
            }
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

        const order = await Order.findOne({ orderId: orderID, user: user._id })
            .populate({
                path: "orderedItems.product",
                select: "productName regularPrice salesPrice offerType totalOffer"
            })
            .populate({
                path: "cancelledItems.product",
                select: "productName regularPrice salesPrice"
            })
            .populate("address");

        if (!order) {
            return res.status(404).send("Order not found");
        }

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=invoice_${order.orderId}.pdf`);
        doc.pipe(res);

        function writeRow(doc, columns, y, strikethrough = false) {
            const colWidths = [180, 40, 70, 80, 80];
            let x = 50;
            columns.forEach((col, i) => {
                if (strikethrough) {
                    doc.save()
                        .moveTo(x, y + 7)
                        .lineTo(x + colWidths[i] - 5, y + 7)
                        .stroke()
                        .restore();
                }
                doc.text(col, x, y, {
                    width: colWidths[i],
                    align: 'left'
                });
                x += colWidths[i];
            });
        }

        // Header
        doc.fontSize(24).text("INVOICE", { align: "center" });
        doc.fontSize(12).text("PAGEFLOW", { align: "center" });
        doc.text("123 Book Street, Literature City, LC 12345", { align: "center" });
        doc.text("Phone: +91 9876543210 | Email: support@pageflow.com", { align: "center" });
        doc.moveDown(1);

        // Order info
        doc.fontSize(10).text(`Invoice Number: ${order.orderId}`);
        doc.text(`Order Date: ${order.createdOn.toLocaleDateString("en-IN")}`);
        doc.text(`Status: ${order.status}`);
        doc.text(`Payment Method: ${order.paymentMethod}`);
        doc.moveDown(1);

        // Billing Address
        if (order.address && order.address.address && order.address.address.length > 0) {
            const billing = order.address.address.find(a => a.isDefault) || order.address.address[0];
            doc.fontSize(14).text("Billing Address:");
            doc.fontSize(10).text(`${billing.name}`);
            doc.text(`${billing.landMark}`);
            doc.text(`${billing.city}, ${billing.state} - ${billing.pincode}`);
            doc.text(`Phone: ${billing.phone}`);
            if (billing.altPhone) doc.text(`Alt Phone: ${billing.altPhone}`);
            doc.moveDown(1);
        }

        // Items table
        doc.fontSize(12).text("Order Items:");
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica-Bold");
        writeRow(doc, ["Item", "Qty", "Price", "Discount", "Total"], doc.y + 5);
        doc.moveDown(1);
        doc.font("Helvetica").fontSize(9);

        let originalSubtotal = 0;
        let discountedSubtotal = 0;

        order.orderedItems.forEach(item => {
            const product = item.product;
            const quantity = item.quantity;
            const regular = product.regularPrice;
            const sales = product.salesPrice;
            const total = regular * quantity;
            const discountedTotal = sales * quantity;
            const discount = total - discountedTotal;

            originalSubtotal += total;
            discountedSubtotal += discountedTotal;

            // Check if this item is also in cancelledItems
            const cancelledItem = order.cancelledItems.find(c => c.product.equals(item.product._id));
            const isCancelled = !!cancelledItem;

            writeRow(doc, [
                product.productName,
                quantity.toString(),
                `₹${regular}`,
                `₹${discount.toFixed(2)}`,
                `₹${discountedTotal.toFixed(2)}`
            ], doc.y, isCancelled);

            if (product.offerType && product.totalOffer) {
                doc.fontSize(8).fillColor("gray").text(`Offer: ${product.offerType} (${product.totalOffer}%)`, 60, doc.y + 12);
                doc.fillColor("black");
            }

            if (isCancelled) {
                doc.fontSize(8).fillColor("red").text(`Cancelled: ${cancelledItem.cancelReason || "N/A"}`, 60, doc.y + 24);
                doc.fillColor("black");
            }

            doc.moveDown(2);
        });

        // Summary
        const coupon = order.discount || 0;
        const shipping = order.shipping || 0;
        const grand = discountedSubtotal - coupon + shipping;

        doc.moveDown(1);
        doc.fontSize(12).text("Payment Summary:");
        doc.fontSize(10);
        doc.text(`Original Subtotal: ₹${originalSubtotal.toFixed(2)}`);
        doc.text(`Discounted Subtotal: ₹${discountedSubtotal.toFixed(2)}`);
        doc.text(`Coupon Discount: ₹${coupon.toFixed(2)}`);
        doc.text(`Shipping: ₹${shipping.toFixed(2)}`);
        doc.fontSize(12).text(`Grand Total: ₹${grand.toFixed(2)}`);

        doc.end();
    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).send("Failed to generate invoice");
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

        console.log('Verifying payment for:', { 
            orderId, 
            razorpay_payment_id, 
            razorpay_order_id 
        });

        // 1. Find the order
        const order = await Order.findOne({ orderId, user: userId });
        if (!order) {
            console.warn('Order not found:', { orderId, userId });
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // 2. Verify the payment signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        console.log('Comparing signatures:', {
            received: razorpay_signature,
            expected: expectedSignature
        });

        if (expectedSignature !== razorpay_signature) {
            console.warn('Invalid payment signature for order:', orderId);
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature'
            });
        }

        // 3. Update order status
        order.paymentStatus = 'Paid';
        order.status = 'Placed';
        order.razorpayPaymentId = razorpay_payment_id;
        order.razorpayOrderId = razorpay_order_id;
        order.razorpaySignature = razorpay_signature;
        
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
        order.status = 'Payment Failed'; 
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
        const { orderId } = req.body
      
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

        if (order.status !== 'Payment Failed') { 
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
            amount: order.finalAmount * 100, 
            currency: 'INR',
            key: process.env.RAZORPAY_ID, 
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