const express = require('express');
const router = express.Router();
const adminController = require("../controllers/admin/adminController.js");
const customerController = require("../controllers/admin/customerController.js"); 
const categoryController = require("../controllers/admin/categoryController.js"); 
const productController = require("../controllers/admin/productController.js"); 
const couponController = require("../controllers/admin/couponController.js");
const orderController = require("../controllers/admin/adminOrderController.js");
const walletController=require("../controllers/admin/walletController.js")
const { userAuth, adminAuth } = require("../middlewares/auth.js");
const upload = require("../helpers/multer.js");

router.get('/pageerror', adminController.pageerror);

router.get("/dashboard", adminAuth, adminController.loadDashboard);

// Login Management
router.get("/login", adminController.loadLogin);
router.post("/login", adminController.login);
router.get("/", adminAuth, adminController.loadDashboard);
router.get("/logout", adminController.logout);
router.get('/sales-report',adminAuth, adminController.getSalesReport);
router.get('/download-report',adminAuth, adminController.downloadReport);


// Customer Management
router.get("/customers", adminAuth, customerController.customerInfo);
router.post("/users/block/:id", adminAuth, customerController.blockCustomer);
router.post("/users/unblock/:id", adminAuth, customerController.unblockCustomer);

// Category Management
router.get("/category", adminAuth, categoryController.categoryInfo);
router.post("/category/add", adminAuth, categoryController.addCategory);
router.post('/category/add-offer', adminAuth, categoryController.addOffer);
router.post('/category/remove-offer', adminAuth, categoryController.removeOffer);
router.get("/category/edit/:id", adminAuth, categoryController.editCategoryPage);
router.post("/category/update/:id", adminAuth, categoryController.updateCategory);
router.get("/category/delete/:id", adminAuth, categoryController.deleteCategory);
router.post("/category/status/:id", adminAuth, categoryController.toggleCategoryStatus);
router.post('/category/list/:id', adminAuth, categoryController.listCategory);
router.post('/category/unlist/:id', adminAuth, categoryController.unlistCategory);

// Product Management
router.get("/add-product", adminAuth, productController.getProductAddPage);
router.post("/add-product", adminAuth, upload.array('images', 4), productController.addProduct);
router.get("/products", adminAuth, productController.getAllProducts);
router.get("/edit-product/:id", adminAuth, productController.getEditProductPage);
router.post("/edit-product/:id", adminAuth, upload.array('images', 4), productController.updateProduct);
router.post("/products/block/:id", adminAuth, productController.blockProduct);
router.post("/products/unblock/:id", adminAuth, productController.unblockProduct);

// Offer Management
router.post('/category/add-offer', adminAuth, categoryController.addOffer);
router.post('/products/add-offer', adminAuth, productController.addProductOffer);
router.post('/products/remove-offer', adminAuth, productController.removeProductOffer);

// Order Management
router.get("/orders", adminAuth, orderController.renderOrderPage);
router.get('/orders/details/:orderId', adminAuth, orderController.renderOrderDetailsPage);
router.post('/orders/update-status', adminAuth, orderController.updateOrderStatus);
router.post('/orders/verify-return', adminAuth, orderController.verifyReturnRequest);

// Coupon Management
router.get('/coupons', adminAuth, couponController.couponInfo);
router.post('/coupons/add', adminAuth, couponController.addCoupon);
router.put('/coupons/edit/:id', adminAuth, couponController.editCoupon);
router.delete('/coupons/delete/:id', adminAuth, couponController.deleteCoupon);
router.post('/coupons/toggle/:id', adminAuth, couponController.toggleCouponStatus);

// Wallet Management
router.get("/wallet", adminAuth, walletController.walletInfo);
router.get("/wallet/orders/:userId", adminAuth,walletController.walletOrders);

module.exports = router;