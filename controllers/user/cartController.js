const mongoose = require('mongoose');
const User = require("../../models/userSchema");
const Address = require("../../models/addressSchema");
const Product = require("../../models/productSchema");
const Cart = require("../../models/cartschema");
const Wishlist = require("../../models/wishlistSchema");
const Category = require("../../models/categorySchema");

const getCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id })
            .populate({
                path: 'items.productId',
                populate: { path: 'category' }
            });

        if (!cart) {
            const newCart = new Cart({ userId: req.user._id, items: [] });
            await newCart.save();
            return res.render('user/cart', { 
                cart: newCart, 
                user: req.user,
                total: 0,
                discount: 0,
                hasValidItems: false,
                currentPage: 'cart'
            });
        }

        let total = 0;
        let totalDiscount = 0;
        let hasValidItems = false;

        cart.items = cart.items.map(item => {
            const product = item.productId;
            let isOutOfStock = false;
            let isInvalid = false;

            // Check if product exists and is valid
            if (!product || product.isBlocked || product.status !== 'Available' || 
                (product.category && !product.category.isListed) || product.quantity <= 0) {
                isInvalid = true;
                isOutOfStock = product && product.quantity <= 0;
            } else {
                hasValidItems = true; // At least one valid item exists
            }

            const originalPrice = product ? (product.salesPrice > 0 ? product.salesPrice : product.regularPrice) : item.price;
            let salePrice = originalPrice;
            let itemDiscount = 0;

            if (!isInvalid) {
                const categoryOffer = product.category && product.category.offer 
                    ? product.category.offer.discountPercentage || 0 
                    : 0;

                const productOffer = product.offer 
                    ? product.offer.discountPercentage || 0 
                    : 0;

                const maxDiscountPercentage = Math.max(categoryOffer, productOffer);
                
                if (maxDiscountPercentage > 0) {
                    itemDiscount = (originalPrice * maxDiscountPercentage) / 100;
                    salePrice = originalPrice - itemDiscount;
                }
            }

            item.salePrice = salePrice;
            item.discount = itemDiscount;
            item.totalPrice = salePrice * item.quantity;
            item.isOutOfStock = isOutOfStock;
            item.isInvalid = isInvalid;

            if (!isInvalid) {
                total += item.totalPrice;
                totalDiscount += itemDiscount * item.quantity;
            }

            return item;
        });

        await cart.save();

        res.render('user/cart', { 
            cart,
            user: req.user,
            total,
            discount: totalDiscount,
            hasValidItems,
            currentPage: 'cart'
        });
    } catch (error) {
        console.error('Error in getCart:', error);
        res.render('user/cart', {
            cart: { items: [] },
            user: req.user,
            total: 0,
            discount: 0,
            hasValidItems: false,
            error: 'Error loading your cart. Please try again later.',
            currentPage: 'cart'
        });
    }
};
const addToCart = async (req, res) => {
    try {
        const userId = req.user?._id;
        const productId = req.params.productId;

        if (!userId) {
            return res.status(401).json({ 
                success: false, 
                message: 'Please log in to add to cart'
            });
        }

        if (!mongoose.isValidObjectId(productId)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid product ID'
            });
        }

        const product = await Product.findById(productId)
            .populate('category')
            .select('+quantity +status +isBlocked +salesPrice +regularPrice');
        
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found'
            });
        }

        const validationErrors = [];
        if (product.isBlocked) validationErrors.push('Product is blocked');
        if (product.quantity <= 0) validationErrors.push('Product is out of stock');
        if (product.status !== 'Available') validationErrors.push(`Product is ${product.status}`);
        if (product.category && !product.category.isListed) validationErrors.push('Product category is not listed');
        
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: validationErrors.join(', ')
            });
        }

        const price = product.salesPrice > 0 ? product.salesPrice : product.regularPrice;
        if (!price || price <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Product price is invalid'
            });
        }

        let cart = await Cart.findOne({ userId }) || 
            new Cart({ userId, items: [] });

        const existingItem = cart.items.find(item => 
            item.productId.toString() === productId
        );

        if (existingItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Product is already in cart'
            });
        }

        cart.items.push({ 
            productId, 
            quantity: 1, 
            price, 
            totalPrice: price,
            status: 'placed'
        });

        await cart.save();
        
        const updatedCart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                select: 'productName productImage regularPrice salesPrice'
            });

        const cartCount = updatedCart.items.reduce((sum, item) => sum + item.quantity, 0);
        const subtotal = updatedCart.items.reduce((sum, item) => sum + item.totalPrice, 0);

        return res.status(200).json({ 
            success: true,
            message: 'Product added to cart',
            cartCount,
            subtotal,
            cartItems: updatedCart.items
        });
    } catch (error) {
        console.error('Error in addToCart:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Server error adding to cart',
            error: error.message
        });
    }
};

const removeFromCart = async (req, res) => {
    try {
        const userId = req.user?._id;
        const productId = req.params.productId; 

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

        const itemIndex = cart.items.findIndex(item => item.productId.toString() === productId);
        
        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Product not found in cart' });
        }

        cart.items.splice(itemIndex, 1);
        await cart.save();

        const total = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);

        return res.status(200).json({ 
            success: true, 
            message: 'Product removed from cart',
            cartCount: cart.items.length,
            total
        });
    } catch (error) {
        console.error('Error in removeFromCart:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error removing product from cart' });
    }
};

const updateCartItemQuantity = async (req, res) => {
    try {
        const { productId, action } = req.body;
        const userId = req.user._id;

        if (!['increment', 'decrement'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid action'
            });
        }

        const cart = await Cart.findOne({ userId })
            .populate({
                path: 'items.productId',
                populate: { path: 'category' }
            });

        if (!cart) {
            return res.status(404).json({ 
                success: false, 
                message: 'Cart not found'
            });
        }

        const cartItem = cart.items.find(item => 
            item.productId && item.productId._id.toString() === productId
        );

        if (!cartItem) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found in cart'
            });
        }

        const product = cartItem.productId;
        if (!product) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product details not found'
            });
        }

        if (product.isBlocked) {
            return res.status(400).json({ 
                success: false, 
                message: 'This product has been blocked and is unavailable'
            });
        }

        if (product.status !== 'Available') {
            return res.status(400).json({ 
                success: false, 
                message: `This product is ${product.status}`
            });
        }

        if (product.category && !product.category.isListed) {
            return res.status(400).json({ 
                success: false, 
                message: 'Product category is not listed'
            });
        }

        if (action === 'increment') {
            if (product.quantity <= 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'No stock available for this product'
                });
            }

            if (cartItem.quantity + 1 > product.quantity) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Cannot add more items. Only ${product.quantity} items available`
                });
            }

            if (cartItem.quantity >= 10) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Maximum quantity limit reached (10)'
                });
            }
            cartItem.quantity += 1;
        } else { 
            if (cartItem.quantity <= 1) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Quantity cannot be less than 1'
                });
            }
            cartItem.quantity -= 1;
        }

        cartItem.totalPrice = cartItem.price * cartItem.quantity;
        cart.markModified('items');
        await cart.save();

        const total = cart.items.reduce((sum, item) => sum + item.totalPrice, 0);

        return res.json({ 
            success: true, 
            message: 'Quantity updated successfully',
            newQuantity: cartItem.quantity,
            newTotalPrice: cartItem.totalPrice,
            total
        });
    } catch (error) {
        console.error('Error in updateCartItemQuantity:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal server error',
            error: error.message
        });
    }
};

module.exports = {
    getCart,
    addToCart,
    removeFromCart,
    updateCartItemQuantity
};