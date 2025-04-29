const mongoose=require('mongoose');
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Cart = require("../../models/cartschema");
const Order = require('../../models/orderSchema');


const getOrdersPage = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).redirect("/login");
        }

        const orders = await Order.find({ user: user._id })
            .populate({
                path: 'orderedItems.product',
                model: 'Product'
            })
            .sort({ orderDate: -1 });

        const formattedOrders = orders.map(order => ({
            orderID: order._id.toString(),
            orderDate: order.orderDate || order.createdOn,
            status: order.status,
            totalAmount: order.totalAmount || order.finalAmount,
            orderedItems: order.orderedItems
        }));

        res.render("user/orders", {
            orders: formattedOrders,
            user: {
                id: user._id,
                name: user.name || "User",
                email: user.email,
                profilePicture: user.profilePicture
            },
            currentPage: 'orders'
        });
    } catch (error) {
        console.error("Error in getOrdersPage:", error);
        res.status(500).render("error", { 
            message: "Failed to load orders",
            error: process.env.NODE_ENV === 'development' ? error : null
        });
    }
};

// Cancel Order
const cancelOrder = async (req, res) => {
    try {
        const { orderID } = req.params;
        const { reason } = req.body;
        const user = req.user;

        // Find the order
        const order = await Order.findOne({ orderId: orderID, address: user._id });
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        // Check if order can be canceled
        if (order.status === "Delivered" || order.status === "Cancelled") {
            return res.status(400).json({ message: "Order cannot be canceled" });
        }

        // Update order status
        order.status = "Cancelled";
        if (reason) {
            order.cancelReason = reason; // Add cancelReason field to schema if needed
        }
        await order.save();

        res.status(200).json({ message: "Order cancelled successfully" });
    } catch (error) {
        console.error("Error cancelling order:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Return Order
const returnOrder = async (req, res) => {
    try {
        const { orderID } = req.params;
        const { reason } = req.body;
        const user = req.user;

        if (!reason) {
            return res.status(400).json({ message: "Return reason is required" });
        }

        // Find the order
        const order = await Order.findOne({ orderId: orderID, address: user._id });
        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        // Check if order can be returned
        if (order.status !== "Delivered") {
            return res.status(400).json({ message: "Only delivered orders can be returned" });
        }

        // Update order status
        order.status = "Return Request";
        order.returnReason = reason; // Add returnReason field to schema if needed
        await order.save();

        res.status(200).json({ message: "Return request submitted successfully" });
    } catch (error) {
        console.error("Error submitting return request:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Download Invoice
const downloadInvoice = async (req, res) => {
    try {
        const { orderID } = req.params;
        const user = req.user;

        // Find the order
        const order = await Order.findOne({ orderId: orderID, address: user._id })
            .populate("orderedItems.product");

        if (!order) {
            return res.status(404).send("Order not found");
        }

        // Generate simple text-based invoice
        const invoiceContent = `
            Invoice for Order #${order.orderId}
            Date: ${new Date(order.createdOn).toLocaleDateString()}
            Status: ${order.status}
            Total Amount: $${order.finalAmount.toFixed(2)}
            
            Items:
            ${order.orderedItems
                .map(
                    item =>
                        `- ${item.product.name} (Qty: ${item.quantity}) - $${item.price.toFixed(2)}`
                )
                .join("\n")}
            
            Thank you for your purchase!
        `;

        // Set headers for file download
        res.setHeader("Content-Disposition", `attachment; filename=invoice_${order.orderId}.txt`);
        res.setHeader("Content-Type", "text/plain");
        res.send(invoiceContent);
    } catch (error) {
        console.error("Error generating invoice:", error);
        res.status(500).send("Server Error");
    }
};

// View Order Details
const getOrderDetails = async (req, res) => {
    try {
        const { orderID } = req.params;
        const user = req.user;

        // Find the order
        const order = await Order.findOne({ orderId: orderID, address: user._id })
            .populate("orderedItems.product");

        if (!order) {
            return res.status(404).send("Order not found");
        }

        res.render("user/orderDetails", {
            order: {
                orderID: order.orderId,
                orderDate: order.createdOn,
                status: order.status,
                totalAmount: order.finalAmount,
                items: order.orderedItems,
                address: order.address, // Populate address if needed
            },
            user: {
                id: user._id,
                name: user.name || "User",
                email: user.email,
            },
        });
    } catch (error) {
        console.error("Error fetching order details:", error);
        res.status(500).send("Server Error");
    }
};

// Export all functions at the end
module.exports = {
    getOrdersPage,
    cancelOrder,
    returnOrder,
    downloadInvoice,
    getOrderDetails,
};