const User = require('../../models/userSchema');
const Wallet = require('../../models/walletSchema');
const Order = require('../../models/orderSchema');


const processedRequestIds = new Set();

const loadWalletPage = async (req, res) => {
    try {
        const userId = req.session.user?.id; 
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User not authenticated' });
        }

        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const wallet = await Wallet.findOne({ user: userId });
        const transactions = wallet
            ? wallet.transactions.sort((a, b) => new Date(b.date) - new Date(a.date))
            : [];

        res.render('user/wallet', {
            user, 
            wallet: wallet || { balance: 0, transactions: [] },
            transactions: transactions
        });
    } catch (error) {
    console.error("User Error:", error);
    res.status(500).render("user/page-404", {
        errorMessage: "Something went wrong. Please try again later.",
    });
}
};

const addToWallet = async ({ userId, amount, description, type = "credit" }) => {
    try {
        console.log('addToWallet called with:', { userId, amount, description, type });
        if (!userId || !amount || isNaN(amount) || amount <= 0) {
            throw new Error("Invalid user ID or amount");
        }

        let wallet = await Wallet.findOne({ user: userId });
        console.log("Wallet found:", wallet);
        if (!wallet) {
            wallet = new Wallet({
                user: userId,
                balance: 0,
                transactions: []
            });
        }

        wallet.transactions.push({
            type: type,
            amount: Number(amount),
            date: new Date(),
            description: description || `${type === "credit" ? "Credit" : "Debit"} transaction`
        });

        wallet.balance = type === "credit" ? wallet.balance + Number(amount) : wallet.balance - Number(amount);
        if (wallet.balance < 0) {
            throw new Error("Insufficient wallet balance");
        }

        await wallet.save();

        console.log(`Wallet updated for user ${userId}: ${type === "credit" ? "Credited" : "Debited"} ₹${amount} for ${description}`);
        return true;
    } catch (error) {
        console.error("Failed to update wallet:", error);
        throw new Error("Failed to update wallet: " + error.message);
    }
};


const addMoney = async (req, res) => {
    try {
        console.log('POST /wallet/add-money received');
        const requestId = req.headers['x-request-id'];
        if (!requestId) {
            console.error('Missing request ID');
            return res.status(400).json({
                success: false,
                error: 'Request ID is required'
            });
        }

        
        if (processedRequestIds.has(requestId)) {
            console.log(`Duplicate request ID detected: ${requestId}`);
            return res.status(200).json({
                success: true,
                message: 'Request already processed'
            });
        }

        const userId = req.session.user?.id;
        let { amount } = req.body;

        
        console.log('Add money request:', { userId, amount, requestId });

        
        if (!userId) {
            console.error('No user ID in session');
            return res.status(401).json({
                success: false,
                error: 'User not authenticated. Please log in again.'
            });
        }

        
        amount = parseFloat(amount);
        if (!amount || isNaN(amount) || amount <= 0) {
            console.error('Invalid amount provided:', amount);
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Please enter a number greater than 0.'
            });
        }

       
        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found in database:', userId);
            return res.status(404).json({
                success: false,
                error: 'User not found.'
            });
        }

        await addToWallet({
            userId,
            amount,
            description: `Added money to wallet`
        });

     
        processedRequestIds.add(requestId);
        
        setTimeout(() => processedRequestIds.delete(requestId), 5 * 60 * 1000);

        console.log(`Successfully added ₹${amount} to wallet for user ${userId}`);

        return res.status(200).json({
            success: true,
            message: `₹${amount.toFixed(2)} added to wallet successfully`
        });
    } catch (error) {
        console.error('Error adding money to wallet:', error.message, error.stack);
        return res.status(500).json({
            success: false,
            error: `Failed to add money to wallet: ${error.message}`
        });
    }
};

const processReturnRequest = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { productId, returnReason } = req.body;
        const userId = req.session.user?._id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User not authenticated'
            });
        }

        const order = await Order.findOne({ orderId: orderId, user: userId });
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const productIndex = order.orderedItems.findIndex(p => p.product.toString() === productId);
        if (productIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Product not found in order'
            });
        }

        const product = order.orderedItems[productIndex];

        if (order.status === 'Returned') {
            return res.status(400).json({
                success: false,
                message: 'Order already returned'
            });
        }

        const isReturnVerified = verifyReturnRequest(product, returnReason);
        
        if (!isReturnVerified) {
            return res.status(400).json({
                success: false,
                message: 'Return request rejected'
            });
        }

        const refundAmount = calculateRefundAmount(product, order);

        if (order.paymentStatus !== 'Paid') {
    console.log('Skipping refund: payment not completed for order', orderId);
} else {
    await addToWallet({
        userId: userId,
        amount: refundAmount,
        description: `Refund for order #${orderId}, product: ${product.productName || 'Unknown Product'} (including shipping)`
    });
}


        order.status = 'Returned';
        order.returnStatus = 'Returned';
        order.returnReason = returnReason;
        order.returnDate = new Date();
        order.refundedAmount = refundAmount;

        order.orderedItems.splice(productIndex, 1);
        if (order.orderedItems.length === 0) {
            order.totalPrice = 0;
            order.discount = 0;
            order.finalAmount = 0;
        } else {
            order.totalPrice = order.orderedItems.reduce((sum, item) => {
                return sum + (item.price * item.quantity);
            }, 0);
            const originalTotalPrice = order.totalPrice + (product.price * product.quantity);
            const discountFactor = order.discount && originalTotalPrice > 0 ? order.discount / originalTotalPrice : 0;
            order.discount = order.totalPrice * discountFactor;
            order.finalAmount = order.totalPrice - order.discount;
        }

        await order.save();

        return res.status(200).json({
            success: true,
            message: `Return processed successfully. ₹${refundAmount.toFixed(2)}  refunded to wallet.`,
            refundAmount: refundAmount
        });
    } catch (error) {
        console.error('Error processing return request:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process return request'
        });
    }
};


function verifyReturnRequest(product, returnReason) {
    const maxReturnDays = 7; 
    const daysSincePurchase = (new Date() - new Date(product.deliveryDate)) / (1000 * 60 * 60 * 24);
    
    if (daysSincePurchase > maxReturnDays) {
        return false; 
    }
    
    if (!returnReason || returnReason.length < 10) {
        return false;
    }
    
    return true;
}


function calculateRefundAmount(product, order) {
    return (product.price * product.quantity) + (order.shipping || 0);
}

module.exports = {
    loadWalletPage,
    addToWallet,
    addMoney,
    processReturnRequest
};