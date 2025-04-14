const express=require('express');
const passport=require('passport');
const router=express.Router();
const { userAuth, adminAuth } = require("../middlewares/auth.js");
const userController=require("../controllers/user/userController");
const profileController=require("../controllers/user/profileController");
const productController=require("../controllers/user/productController")


//logini and signup
router.get("/pageNotfound", userController.pageNotFound);
router.get("/", userController.loadHomepage);
router.get("/signup", userController.loadSignup); 
router.post("/signup", userController.registerUser);
router.get("/login", userController.loadLogin);
router.post("/login", userController.loginUser);
router.get("/home", userController.loadHome);
router.post("/verify-otp", userController.verifyOTP);
router.get("/resend-otp", userController.resendOTP);

router.get('/auth/google',passport.authenticate('google',{scope:['profile','email']}));

router.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        req.session.user = {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
        };
        res.redirect("/home"); // Redirect to home after login
    }
);

router.get("/logout",userController.logout);


//forgotPassword
router.get('/forgotPassword', profileController.getForgotPasspage);
router.post('/forgotPassword', profileController.forgotPassword);
router.get('/verifyOtp', profileController.getVerifyOtpPage);
router.post('/verifyOtp', profileController.verifyOtp);
router.get('/resetPassword', profileController.getResetPasswordPage);
router.post('/resetPassword', profileController.resetPassword);
router.get('/resend-otp-forgot', profileController.resendOTP);


//productManagement

router.get('/loadShoppingPage', userAuth, productController.loadShoppingPage);
router.get('/productDetails',userAuth,productController.productDetails)




module.exports = router