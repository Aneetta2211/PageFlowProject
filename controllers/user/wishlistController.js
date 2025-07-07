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
        console.error("Error fetching wishlist:", error);
        res.status(500).render('error', { error: "Failed to load wishlist" });
    }
};

const addToWishlist = async (req, res) => {
    try {
        const userId = req.session.user?._id || req.session.user?.id;
        if (!userId) {
            return res.status(401).json({ 
                error: "Authentication required",
                loginUrl: "/login?returnUrl=" + encodeURIComponent(req.originalUrl)
            });
        }

        const { productId } = req.body;
        if (!productId || !mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ error: "Invalid product ID" });
        }

        const product = await Product.findById(productId);
        if (!product || product.isBlocked || product.status !== "Available") {
            return res.status(404).json({ error: "Product not available" });
        }

        let wishlist = await Wishlist.findOne({ userId });

        if (!wishlist) {
            wishlist = new Wishlist({
                userId,
                products: [{ productId }]
            });
            await wishlist.save();
            console.log('New wishlist created:', JSON.stringify(wishlist, null, 2));
            return res.status(201).json({
                success: true,
                message: "Product added to wishlist",
                productName: product.productName,
                productImage: product.productImage[0] || null,
                wishlistUrl: "/profile/wishlist"
            });
        }

        const productExists = wishlist.products.some(item => 
            item.productId.toString() === productId.toString()
        );
        
        if (productExists) {
            return res.status(200).json({
                success: true,
                message: "Product already in wishlist",
                productName: product.productName,
                wishlistUrl: "/profile/wishlist"
            });
        }

        wishlist.products.push({ productId });
        await wishlist.save();
        console.log('Wishlist updated:', JSON.stringify(wishlist, null, 2));

        res.status(201).json({
            success: true,
            message: "Product added to wishlist",
            productName: product.productName,
            productImage: product.productImage[0] || null,
            wishlistUrl: "/profile/wishlist"
        });

    } catch (error) {
        console.error("Wishlist Error:", error);
        res.status(500).json({
            error: "Internal server error",
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const removeFromWishlist = async (req, res) => {
    try {
        const userId = req.session.user?._id || req.session.user?.id;
        const { productId } = req.body;

        if (!userId) {
            return res.status(401).json({ error: "User not logged in" });
        }

        let wishlist = await Wishlist.findOne({ userId });
        if (!wishlist) {
            return res.status(404).json({ error: "Wishlist not found" });
        }

        const initialLength = wishlist.products.length;
        wishlist.products = wishlist.products.filter(item => 
            item.productId.toString() !== productId.toString()
        );

        if (wishlist.products.length === initialLength) {
            return res.status(404).json({ error: "Product not found in wishlist" });
        }

        await wishlist.save();
        console.log('Wishlist after removal:', JSON.stringify(wishlist, null, 2));
        res.status(200).json({ success: true, message: "Removed from wishlist" });
    } catch (error) {
        console.error("Error removing from wishlist:", error);
        res.status(500).json({ error: "Server error" });
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

        const productOffer = product.productOffer || 0;
        const finalPrice = productOffer > 0
            ? parseFloat((product.salesPrice - (product.salesPrice * productOffer / 100)).toFixed(2))
            : parseFloat(product.salesPrice.toFixed(2));

        let cart = await Cart.findOne({ userId });

        if (!cart) {
            if (quantity > 5) {
                return res.status(400).json({ error: "Cannot add more than 5 of this product" });
            }
            cart = new Cart({
                userId,
                items: [{
                    productId,
                    quantity,
                    price: finalPrice,
                    totalPrice: parseFloat((finalPrice * quantity).toFixed(2))
                }]
            });
        } else {
            const existingItemIndex = cart.items.findIndex(
                item => item.productId.toString() === productId.toString()
            );

            if (existingItemIndex !== -1) {
                const newQuantity = cart.items[existingItemIndex].quantity + quantity;
                if (newQuantity > 5) {
                    return res.status(400).json({ error: "Maximum limit of 5 per product reached" });
                }
                if (newQuantity > product.quantity) {
                    return res.status(400).json({ error: `Only ${product.quantity} items available` });
                }
                cart.items[existingItemIndex].quantity = newQuantity;
                cart.items[existingItemIndex].totalPrice = parseFloat(
                    (newQuantity * finalPrice).toFixed(2)
                );
            } else {
                if (quantity > 5) {
                    return res.status(400).json({ error: "Cannot add more than 5 of this product" });
                }
                if (quantity > product.quantity) {
                    return res.status(400).json({ error: `Only ${product.quantity} items available` });
                }
                cart.items.push({
                    productId,
                    quantity,
                    price: finalPrice,
                    totalPrice: parseFloat((finalPrice * quantity).toFixed(2))
                });
            }
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

        res.status(200).json({ 
            success: true, 
            message: "Added to cart and removed from wishlist",
            cartUrl: "/profile/cart",
            cartCount: cart.items.length
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