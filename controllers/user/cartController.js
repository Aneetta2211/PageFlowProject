const mongoose = require('mongoose');
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Product = require("../../models/productSchema");
const Cart = require("../../models/cartschema");
const Wishlist = require("../../models/wishlistSchema");

const getCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id })
            .populate({
                path: 'items.productId',
                populate: {
                    path: 'category'
                }
            });

        if (!cart) {
            const newCart = new Cart({
                userId: req.user._id,
                items: []
            });
            await newCart.save();
            return res.render('user/cart', { 
                cart: newCart, 
                user: req.user 
            });
        }

        res.render('user/cart', { 
            cart,
            user: req.user 
        });
    } catch (error) {
        res.render('user/cart', {
            cart: { items: [] },
            user: req.user,
            error: 'Error loading your cart. Please try again later.'
        });
    }
};

const addToCart = async (req, res) => {
    try {
        const userId = req.user?._id;
        const productId = req.params.productId;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please log in to add to cart' });
        }

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID' });
        }

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        
        if (product.isBlocked || product.status === 'out of stock' || product.status === 'Discontinued') {
            return res.status(400).json({ success: false, message: 'Product is not available' });
        }

        const price = product.salesPrice > 0 ? product.salesPrice : product.regularPrice;
        if (!price || price <= 0) {
            return res.status(400).json({ success: false, message: 'Product price is invalid' });
        }

        const quantity = 1;
        const totalPrice = price * quantity;

        let cart = await Cart.findOne({ userId });
        
        if (!cart) {
            cart = new Cart({ userId, items: [] });
        }

        const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
        if (itemIndex > -1) {
            cart.items[itemIndex].quantity += 1;
            cart.items[itemIndex].totalPrice = cart.items[itemIndex].quantity * price;
        } else {
            cart.items.push({ 
                productId, 
                quantity, 
                price, 
                totalPrice,
                status: 'placed',
                cancellationReason: 'none'
            });
        }

        const savedCart = await cart.save();
        const verifiedCart = await Cart.findOne({ userId }).populate('items.productId');

        return res.status(200).json({ 
            success: true, 
            message: 'Product added to cart',
            showCartOptions: true,
            cartCount: verifiedCart.items.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Error adding product to cart' });
    }
};




const removeFromCart = async (req, res) => {
    try {
        const userId = req.user?._id;
        const productId = req.params.productId; // Get productId from URL params

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Please log in to remove from cart' });
        }

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ success: false, message: 'Invalid product ID' });
        }

        const cart = await Cart.findOne({ userId });
        
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }

        // Find the item index in the cart
        const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
        
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Product not found in cart' });
        }

        // Remove the item from the cart
        cart.items.splice(itemIndex, 1);
        
        // Save the updated cart
        await cart.save();
        
        return res.status(200).json({ 
            success: true, 
            message: 'Product removed from cart',
            cartCount: cart.items.length
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message || 'Error removing product from cart' });
    }
};


module.exports = {
    getCart,
    addToCart,
    removeFromCart
};