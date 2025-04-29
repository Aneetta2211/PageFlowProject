
const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const Address=require("../../models/addressSchema")
const Order = require('../../models/orderSchema');



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

module.exports = { 
    renderOrderPage

};