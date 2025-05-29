const Wallet = require("../../models/walletSchema");
const User = require("../../models/userSchema");
const Order = require("../../models/orderSchema");

const walletInfo = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const search = req.query.search || "";

      
        const userQuery = {
            $or: [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { phone: { $regex: search, $options: "i" } }
            ]
        };

        
        const users = await User.find(userQuery).select("_id name email phone");
        const userIds = users.map(user => user._id);

       
        const query = { user: { $in: userIds } };
        const totalWallets = await Wallet.countDocuments(query);
        const totalPages = Math.ceil(totalWallets / limit);
        const wallets = await Wallet.find(query)
            .populate("user", "name email phone")
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        res.render("admin/wallet", {
            wallets,
            currentPage: page,
            totalPages,
            search
        });
    } catch (error) {
        console.error("Error fetching wallet info:", error);
        res.redirect("/admin/pageerror");
    }
};

const walletOrders = async (req, res) => {
    try {
        const userId = req.params.userId;

        
        const user = await User.findById(userId).select("name email phone").lean();
        if (!user) {
            return res.redirect("/admin/pageerror");
        }

       
        const wallet = await Wallet.findOne({ user: userId }).lean();
        if (!wallet) {
            return res.render("-DASHBOARD/walletOrders", {
                user,
                orders: [],
                wallet: { balance: 0, transactions: [] }
            });
        }

        
        const orders = await Order.find({ user: userId, paymentMethod: 'wallet' })
            .populate({
                path: 'orderedItems.product',
                select: 'productName salesPrice productImage'
            })
            .select('orderId totalPrice finalAmount status paymentStatus createdOn orderedItems')
            .lean();

        
        orders.forEach(order => {
            order.orderedItems.forEach(item => {
                if (item.price === undefined) {
                    console.warn(`Order ${order.orderId} has item with undefined price:`, item);
                    item.price = 0; 
                }
            });
        });

        res.render("admin/walletOrders", {
            user,
            orders,
            wallet
        });
    } catch (error) {
        console.error("Error fetching wallet orders:", error);
        res.redirect("/admin/pageerror");
    }
};

module.exports = {
    walletInfo,
    walletOrders
};