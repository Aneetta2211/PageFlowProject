
const express = require('express');
const passport = require('passport');
const router = express.Router();
const { userAuth, adminAuth } = require("../middlewares/auth.js");
const profileUpload=require("../middlewares/profileUpload.js")
const userController = require("../controllers/user/userController");
const profileController = require("../controllers/user/profileController");
const productController = require("../controllers/user/productController");
const orderController = require("../controllers/user/orderController");
const cartController = require("../controllers/user/cartController.js");
const walletController = require("../controllers/user/walletController.js");
const wishlistController = require("../controllers/user/wishlistController.js");

// Login and Signup
router.get("/pageNotfound", userController.pageNotFound);
router.get("/", userController.loadHomepage);
router.get("/signup", userController.loadSignup);
router.post("/signup", userController.registerUser);
router.get("/login", userController.loadLogin);
router.post("/login", userController.loginUser);
router.get("/home", userAuth, userController.loadHome);
router.post("/verify-otp", userController.verifyOTP);
router.get("/resend-otp", userController.resendOTP);

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        req.session.user = {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
        };
        res.redirect("/home");
    }
);

router.get("/logout", userController.logout);
router.get("/about", userController.loadAbout);
router.get("/contact",userController.loadContact);

// Forgot Password
router.get('/forgotPassword', profileController.getForgotPasspage);
router.post('/forgotPassword', profileController.forgotPassword);
router.get('/verifyOtp', profileController.getVerifyOtpPage);
router.post('/verifyOtp', profileController.verifyOtp);
router.get('/resetPassword', profileController.getResetPasswordPage);
router.post('/resetPassword', profileController.resetPassword);
router.get('/resend-otp-forgot', profileController.resendOTP);

// Product Management
router.get('/loadShoppingPage', userAuth, productController.loadShoppingPage);
router.get('/productDetails/:productId', userAuth, productController.productDetails);


// Profile Management
router.get('/profile', userAuth, profileController.getProfilePage);
router.post('/profile/send-otp', userAuth, profileController.sendOtpForEmail);
router.post('/profile/verify-otp', userAuth, profileController.verifyEmailChangeOtp);
router.post('/profile/resend-otp', userAuth, profileController.resendOtp);
router.post('/profile/delete-image', userAuth, profileController.deleteProfileImage);
router.post('/profile/update', userAuth, profileUpload.single('profileImage'), profileController.updateProfile);

// Address routes
router.get('/profile/addresses', userAuth, profileController.getAddressesPage);
router.get('/profile/addresses/add', userAuth, profileController.getAddAddressPage);
router.post('/profile/addresses/add', userAuth, profileController.addAddress);
router.get('/profile/addresses/edit/:id', userAuth, profileController.getEditAddressPage);
router.post('/profile/addresses/edit/:id', userAuth, profileController.updateAddress);
router.delete('/profile/addresses/delete/:id', userAuth, profileController.deleteAddress);
router.post('/profile/addresses/set-default/:id', userAuth, profileController.setDefaultAddress); 

// Order Management
router.get("/profile/orders", userAuth, orderController.getOrdersPage);
router.get("/orders/:orderID", userAuth, orderController.getOrderDetails);
router.post("/api/orders/:orderID/return", userAuth, orderController.returnOrder);
router.get("/api/orders/:orderID/invoice", userAuth, orderController.downloadInvoice);
router.get('/checkout', userAuth, orderController.renderCheckout);
router.post('/order/place', userAuth, orderController.placeOrder);
router.post("/api/orders/:orderID/cancel", userAuth, orderController.cancelOrder);
router.post("/api/orders/:orderID/cancel-item/:productID", userAuth, orderController.cancelOrderItem);

//razorpay management
router.post('/verify-payment', userAuth,orderController.verifyPayment);
router.post('/payment-failed',userAuth, orderController.paymentFailed);
router.post('/retry-payment', userAuth,orderController.retryPayment);

//coupon mangement
router.post('/apply-coupon', userAuth, orderController.applyCoupon); 
router.post('/remove-coupon', userAuth, orderController.removeCoupon);

// Cart Management
router.get('/profile/cart', userAuth, cartController.getCart);
router.post('/cart/add/:productId', userAuth, cartController.addToCart);
router.delete('/cart/:productId', userAuth, cartController.removeFromCart);
router.post('/cart/update', userAuth, cartController.updateCartItemQuantity); 

// Wallet Management
router.get('/profile/wallet', userAuth, walletController.loadWalletPage);
router.post('/wallet/add-money', userAuth, walletController.addMoney);
router.post('/api/orders/:orderId/return', userAuth, walletController.processReturnRequest);

// Wishlist Management
router.get('/profile/wishlist', userAuth, wishlistController.getWishlist); 
router.post('/wishlist/add', userAuth, wishlistController.addToWishlist);
router.delete('/wishlist/remove', userAuth, wishlistController.removeFromWishlist); 
router.post('/wishlist/add-to-cart/:productId', userAuth, wishlistController.addToCart);



module.exports = router;