const mongoose = require("mongoose");
const Coupon = require("../../models/couponSchema");
const Cart = require("../../models/cartschema");



const couponInfo = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 4;
    const skip = (page - 1) * limit;
    const searchQuery = req.query.search ? req.query.search.trim() : "";

    let filter = {};
    if (req.query.clear) {
      filter = {};
    } else if (searchQuery) {
      filter = { code: { $regex: searchQuery, $options: "i" } };
    }

    const couponData = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

   
    const formattedCoupons = couponData.map(coupon => {
      return {
        ...coupon,
        startDate: coupon.startDate ? new Date(coupon.startDate) : new Date(), 
        expiryDate: coupon.expiryDate ? new Date(coupon.expiryDate) : new Date(), 
      };
    });

    const totalCoupons = await Coupon.countDocuments(filter);
    const totalPages = totalCoupons > 0 ? Math.ceil(totalCoupons / limit) : 1;

    res.render("admin/coupons", {
      coupons: formattedCoupons,
      currentPage: page,
      totalPages: totalPages,
      totalCoupons: totalCoupons,
      limit: limit,
      searchQuery: searchQuery,
      layout: false,
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.render("admin/coupons", {
      coupons: [],
      currentPage: 1,
      totalPages: 1,
      totalCoupons: 0,
      limit: 4,
      searchQuery: "",
      layout: false,
    });
  }
};





const addCoupon = async (req, res) => {
  try {
    console.log('addCoupon: Received request body:', req.body);

    const { code, discountType, discount, minPurchase, maxDiscount, startDate, expiryDate } = req.body;

    
    if (!code || !discountType || !discount || !startDate || !expiryDate) {
      console.log('addCoupon: Missing required fields:', { code, discountType, discount, startDate, expiryDate });
      return res.status(400).json({ success: false, message: 'All required fields (code, discountType, discount, startDate, expiryDate) must be provided' });
    }

    
    if (code.length < 3 || code.length > 20 || !/^[a-zA-Z0-9]+$/.test(code)) {
      console.log('addCoupon: Invalid coupon code:', code);
      return res.status(400).json({ success: false, message: 'Coupon code must be 3-20 alphanumeric characters' });
    }

    
    if (!['percentage', 'fixed'].includes(discountType)) {
      console.log('addCoupon: Invalid discountType:', discountType);
      return res.status(400).json({ success: false, message: 'Discount type must be "percentage" or "fixed"' });
    }

   
    const discountValue = parseFloat(discount);
    if (isNaN(discountValue) || discountValue <= 0) {
      console.log('addCoupon: Invalid discount:', discount);
      return res.status(400).json({ success: false, message: 'Discount must be a positive number' });
    }
    if (discountType === 'percentage' && (discountValue > 100 || discountValue < 1)) {
      console.log('addCoupon: Invalid percentage discount:', discountValue);
      return res.status(400).json({ success: false, message: 'Percentage discount must be between 1% and 100%' });
    }
    if (discountType === 'fixed' && discountValue > 10000) {
      console.log('addCoupon: Invalid fixed discount:', discountValue);
      return res.status(400).json({ success: false, message: 'Fixed discount cannot exceed ₹10,000' });
    }

    
    const minPurchaseValue = parseFloat(minPurchase) || 0;
    if (isNaN(minPurchaseValue) || minPurchaseValue < 0) {
      console.log('addCoupon: Invalid minPurchase:', minPurchase);
      return res.status(400).json({ success: false, message: 'Minimum purchase must be a non-negative number' });
    }

   
    const maxDiscountValue = parseFloat(maxDiscount) || 0;
    if (isNaN(maxDiscountValue) || maxDiscountValue < 0) {
      console.log('addCoupon: Invalid maxDiscount:', maxDiscount);
      return res.status(400).json({ success: false, message: 'Maximum discount must be a non-negative number' });
    }
    if (discountType === 'percentage' && maxDiscountValue > 10000) {
      console.log('addCoupon: Invalid maxDiscount for percentage:', maxDiscountValue);
      return res.status(400).json({ success: false, message: 'Maximum discount for percentage coupons cannot exceed ₹10,000' });
    }

    
    const parsedStartDate = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(parsedStartDate.getTime())) {
      console.log('addCoupon: Invalid startDate:', startDate);
      return res.status(400).json({ success: false, message: 'Start date must be a valid date' });
    }

    
    const parsedExpiryDate = new Date(expiryDate);
    if (isNaN(parsedExpiryDate.getTime()) || parsedExpiryDate < today) {
      console.log('addCoupon: Invalid expiryDate:', expiryDate);
      return res.status(400).json({ success: false, message: 'Expiry date must be a valid date and not in the past' });
    }

    
    if (parsedStartDate > parsedExpiryDate) {
      console.log('addCoupon: startDate after expiryDate:', { startDate, expiryDate });
      return res.status(400).json({ success: false, message: 'Start date must be before or equal to expiry date' });
    }

   
    const existingCoupon = await Coupon.findOne({
      code: code.toUpperCase(),
    });

    if (existingCoupon) {
      console.log('addCoupon: Coupon code already exists:', code);
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    const newCoupon = new Coupon({
      code: code.toUpperCase(),
      discountType,
      discount: discountValue,
      minPurchase: minPurchaseValue,
      maxDiscount: maxDiscountValue,
      startDate: parsedStartDate,
      expiryDate: parsedExpiryDate,
      isActive: true,
      usage: []
    });

    await newCoupon.save();
    console.log('addCoupon: Coupon created successfully:', newCoupon);
    res.status(201).json({ success: true, message: 'Coupon added successfully' });
  } catch (error) {
    console.error('addCoupon: Error adding coupon:', error);
    res.status(500).json({ success: false, message: 'Server error while adding coupon', error: error.message });
  }
};


const editCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const { code, discountType, discount, minPurchase, maxDiscount, startDate, expiryDate, isActive } = req.body;

    console.log('editCoupon: Request params:', req.params);
    console.log('editCoupon: Request body:', req.body);

   
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('editCoupon: Invalid coupon ID:', id);
      return res.status(400).json({ success: false, message: 'Invalid coupon ID' });
    }

   
    if (!code || !discountType || !discount || !startDate || !expiryDate) {
      console.log('editCoupon: Missing required fields:', { code, discountType, discount, startDate, expiryDate });
      return res.status(400).json({ success: false, message: 'All required fields (code, discountType, discount, startDate, expiryDate) must be provided' });
    }

    
    if (code.length < 3 || code.length > 20 || !/^[a-zA-Z0-9]+$/.test(code)) {
      console.log('editCoupon: Invalid coupon code:', code);
      return res.status(400).json({ success: false, message: 'Coupon code must be 3-20 alphanumeric characters' });
    }

    
    if (!['percentage', 'fixed'].includes(discountType)) {
      console.log('editCoupon: Invalid discount type:', discountType);
      return res.status(400).json({ success: false, message: 'Discount type must be "percentage" or "fixed"' });
    }

    
    const discountValue = parseFloat(discount);
    if (isNaN(discountValue) || discountValue <= 0) {
      console.log('editCoupon: Invalid discount:', discount);
      return res.status(400).json({ success: false, message: 'Discount must be a positive number' });
    }
    if (discountType === 'percentage' && (discountValue > 100 || discountValue < 1)) {
      console.log('editCoupon: Invalid percentage discount:', discountValue);
      return res.status(400).json({ success: false, message: 'Percentage discount must be between 1% and 100%' });
    }
    if (discountType === 'fixed' && discountValue > 10000) {
      console.log('editCoupon: Invalid fixed discount:', discountValue);
      return res.status(400).json({ success: false, message: 'Fixed discount cannot exceed ₹10,000' });
    }

    
    const minPurchaseValue = parseFloat(minPurchase) || 0;
    if (isNaN(minPurchaseValue) || minPurchaseValue < 0) {
      console.log('editCoupon: Invalid minPurchase:', minPurchase);
      return res.status(400).json({ success: false, message: 'Minimum purchase must be a non-negative number' });
    }

   
    const maxDiscountValue = parseFloat(maxDiscount) || 0;
    if (isNaN(maxDiscountValue) || maxDiscountValue < 0) {
      console.log('editCoupon: Invalid maxDiscount:', maxDiscount);
      return res.status(400).json({ success: false, message: 'Maximum discount must be a non-negative number' });
    }
    if (discountType === 'percentage' && maxDiscountValue > 10000) {
      console.log('editCoupon: Invalid maxDiscount for percentage:', maxDiscountValue);
      return res.status(400).json({ success: false, message: 'Maximum discount for percentage coupons cannot exceed ₹10,000' });
    }

    
    const parsedStartDate = new Date(startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(parsedStartDate.getTime())) {
      console.log('editCoupon: Invalid startDate:', startDate);
      return res.status(400).json({ success: false, message: 'Start date must be a valid date' });
    }

   
    const parsedExpiryDate = new Date(expiryDate);
    if (isNaN(parsedExpiryDate.getTime()) || parsedExpiryDate < today) {
      console.log('editCoupon: Invalid expiryDate:', expiryDate);
      return res.status(400).json({ success: false, message: 'Expiry date must be a valid date and not in the past' });
    }

   
    if (parsedStartDate > parsedExpiryDate) {
      console.log('editCoupon: startDate after expiryDate:', { startDate, expiryDate });
      return res.status(400).json({ success: false, message: 'Start date must be before or equal to expiry date' });
    }

    
    if (isActive !== true && isActive !== false && isActive !== 'true' && isActive !== 'false') {
      console.log('editCoupon: Invalid isActive:', isActive);
      return res.status(400).json({ success: false, message: 'Status must be true or false' });
    }

    console.log('editCoupon: Fetching coupon with ID:', id);
    const coupon = await Coupon.findById(id);
    if (!coupon) {
      console.log('editCoupon: Coupon not found for ID:', id);
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }

    console.log('editCoupon: Checking for duplicate coupon code:', code.toUpperCase());
    const existingCoupon = await Coupon.findOne({
      code: code.toUpperCase(),
      _id: { $ne: id },
    });

    if (existingCoupon) {
      console.log('editCoupon: Duplicate coupon code found:', code);
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    console.log('editCoupon: Updating coupon:', id);
    coupon.code = code.toUpperCase();
    coupon.discountType = discountType;
    coupon.discount = discountValue;
    coupon.minPurchase = minPurchaseValue;
    coupon.maxDiscount = maxDiscountValue;
    coupon.startDate = parsedStartDate;
    coupon.expiryDate = parsedExpiryDate;
    coupon.isActive = isActive === 'true' || isActive === true;

    await coupon.save();
    console.log('editCoupon: Coupon updated successfully:', id);
    res.json({ success: true, message: 'Coupon updated successfully' });
  } catch (error) {
    console.error('editCoupon: Error editing coupon:', error);
    res.status(500).json({ success: false, message: 'Server error while editing coupon', error: error.message });
  }
};


const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByIdAndDelete(id);
    if (!coupon) {
      return res.json({ success: false, message: "Coupon not found" });
    }
    res.json({ success: true, message: "Coupon deleted successfully" });
  } catch (error) {
    console.error("Error deleting coupon:", error);
    res.json({ success: false, message: "Error deleting coupon" });
  }
};

const toggleCouponStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.json({ success: false, message: "Coupon not found" });
    }

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    res.json({
      success: true,
      newStatus: coupon.isActive ? "active" : "inactive",
      message: `Coupon is now ${coupon.isActive ? "active" : "inactive"}`,
    });
  } catch (error) {
    console.error("Error toggling coupon status:", error);
    res.json({ success: false, message: "Error toggling coupon status" });
  }
};



module.exports = {
  couponInfo,
  addCoupon,
  editCoupon,
  deleteCoupon,
  toggleCouponStatus,
  
};