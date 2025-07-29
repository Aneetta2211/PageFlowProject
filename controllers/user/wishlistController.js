const mongoose = require('mongoose');
const Wishlist = require('../../models/wishlistSchema');
const Product = require('../../models/productSchema');
const Cart = require('../../models/cartSchema');

const getWishlist = async (req, res) => {
    try {
        const userId = req.session.user?._id || req.session.user?.id;
        
        if (!userId) {
            return res.redirect('/login');
        }

        let wishlistItems = await Wishlist.findOne({ userId })
            .populate({
                path: 'products.productId',
                model: 'product', 
                select: 'productName salesPrice quantity status productImage'
            }) || { products: [] };

        console.log('Wishlist Items:', JSON.stringify(wishlistItems, null, 2));

        const cartItems = await Cart.findOne({ userId })
            .then(cart => cart ? cart.items.map(item => item.productId.toString()) : []);
        
        res.render('user/wishlist', { 
            wishlistItems,
            cartItems,
            user: req.session.user 
        });
    } catch (error) {
    console.error("User Error:", error);
    res.status(500).render("user/page-404", {
        errorMessage: "Something went wrong. Please try again later.",
    });
}
};

const addToWishlist = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Authentication required",
                loginUrl: "/login" 
            });
        }

        const { productId } = req.body;
        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ 
                success: false,
                message: "Invalid product ID" 
            });
        }

        const product = await Product.findById(productId);
        if (!product || product.isBlocked || product.status !== "Available") {
            return res.status(400).json({ 
                success: false,
                message: "Product not available" 
            });
        }

        let wishlist = await Wishlist.findOne({ userId }) || 
            new Wishlist({ userId, products: [] });

        const exists = wishlist.products.some(item => 
            item.productId.toString() === productId
        );
        
        if (exists) {
            return res.status(200).json({
                success: true,
                message: "Product already in wishlist"
            });
        }

        wishlist.products.push({ productId });
        await wishlist.save();

        res.status(200).json({
            success: true,
            message: "Added to wishlist",
            wishlistUrl: "/profile/wishlist"
        });

    } catch (error) {
        console.error("Wishlist Error:", error);
        res.status(500).json({ 
            success: false,
            message: "Internal server error"
        });
    }
};

const removeFromWishlist = async (req, res) => {
    try {
        const userId = req.session.user?.id;
        const { productId } = req.body;

        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Authentication required" 
            });
        }

        const wishlist = await Wishlist.findOne({ userId });
        if (!wishlist) {
            return res.status(404).json({ 
                success: false,
                message: "Wishlist not found" 
            });
        }

        const initialCount = wishlist.products.length;
        wishlist.products = wishlist.products.filter(
            item => item.productId.toString() !== productId
        );

        if (wishlist.products.length === initialCount) {
            return res.status(404).json({ 
                success: false,
                message: "Product not found in wishlist" 
            });
        }

        await wishlist.save();
        res.status(200).json({ 
            success: true,
            message: "Removed from wishlist" 
        });

    } catch (error) {
        console.error("Wishlist Error:", error);
        res.status(500).json({ 
            success: false,
            message: "Internal server error"
        });
    }
};

const addToCart = async (req, res) => {
    try {
        const userId = req.session.user?._id || req.session.user?.id;
        const productId = req.params.productId;
        const quantity = parseInt(req.body.quantity, 10) || 1;

        if (!userId) {
            return res.status(401).json({ error: "User not logged in", loginUrl: "/login" });
        }

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ error: "Invalid product ID" });
        }

        const product = await Product.findById(productId);
        if (!product || product.isBlocked || product.status !== "Available") {
            return res.status(404).json({ error: "Product not available" });
        }

        if (product.quantity < quantity) {
            return res.status(400).json({ error: `Only ${product.quantity} items available` });
        }

        const maxQuantity = 10; // Align with cartController
        if (quantity > maxQuantity) {
            return res.status(400).json({ error: `Cannot add more than ${maxQuantity} of this product` });
        }

        const productOffer = product.productOffer || 0;
        const finalPrice = productOffer > 0
            ? parseFloat((product.salesPrice - (product.salesPrice * productOffer / 100)).toFixed(2))
            : parseFloat(product.salesPrice.toFixed(2));

        let cart = await Cart.findOne({ userId });

        if (!cart) {
            cart = new Cart({
                userId,
                items: [{
                    productId,
                    quantity,
                    price: finalPrice,
                    totalPrice: parseFloat((finalPrice * quantity).toFixed(2)),
                    status: 'placed'
                }]
            });
        } else {
            const existingItemIndex = cart.items.findIndex(
                item => item.productId.toString() === productId.toString()
            );

            if (existingItemIndex !== -1) {
                return res.status(400).json({ 
                    success: false, 
                    message: "Product is already in the cart" 
                });
            }

            cart.items.push({
                productId,
                quantity,
                price: finalPrice,
                totalPrice: parseFloat((finalPrice * quantity).toFixed(2)),
                status: 'placed'
            });
        }

        await cart.save();

        let wishlist = await Wishlist.findOne({ userId });
        if (wishlist) {
            wishlist.products = wishlist.products.filter(item => 
                item.productId.toString() !== productId.toString()
            );
            await wishlist.save();
            console.log('Wishlist after cart addition:', JSON.stringify(wishlist, null, 2));
        }

        const cartCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

        res.status(200).json({ 
            success: true, 
            message: "Added to cart and removed from wishlist",
            cartCount,
            cartUrl: "/profile/cart"
        });
    } catch (error) {
        console.error("Add to cart error:", error);
        res.status(500).json({ 
            error: "Server error",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined 
        });
    }
};

module.exports = {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    addToCart
};