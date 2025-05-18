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

    const totalCoupons = await Coupon.countDocuments(filter);
    const totalPages = totalCoupons > 0 ? Math.ceil(totalCoupons / limit) : 1;

    res.render("admin/coupons", {
      coupons: couponData,
      currentPage: page,
      totalPages: totalPages,
      totalCoupons: totalCoupons,
      limit: limit,
      searchQuery: searchQuery,
      layout: false,
    });
  } catch (error) {
    console.error("Error fetching coupons:", error);
    res.render("admin/coupon", {
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

    const { code, discountType, discount, minPurchase, maxDiscount, expiryDate } = req.body;

    if (!code || !discountType || !discount || !expiryDate) {
      console.log('addCoupon: Missing required fields:', { code, discountType, discount, expiryDate });
      return res.status(400).json({ success: false, message: 'All required fields (code, discountType, discount, expiryDate) must be provided' });
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

    const parsedExpiryDate = new Date(expiryDate);
    if (isNaN(parsedExpiryDate.getTime())) {
      console.log('addCoupon: Invalid expiryDate:', expiryDate);
      return res.status(400).json({ success: false, message: 'Invalid expiry date format' });
    }

    const existingCoupon = await Coupon.findOne({
      code: { $regex: new RegExp(`^${code.toUpperCase()}$`, 'i') },
    });

    if (existingCoupon) {
      console.log('addCoupon: Coupon code already exists:', code);
      return res.status(400).json({ success: false, message: 'Coupon code already exists' });
    }

    const newCoupon = new Coupon({
      code: code.toUpperCase(),
      discountType,
      discount: discountValue,
      minPurchase: parseFloat(minPurchase) || 0,
      maxDiscount: parseFloat(maxDiscount) || 0,
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
    const { code, discountType, discount, minPurchase, maxDiscount, expiryDate, isActive } = req.body;

    // Validate required fields
    if (!code || !discountType || !discount || !expiryDate) {
      return res.json({ success: false, message: "All required fields must be provided" });
    }

    // Validate discountType
    if (!["percentage", "fixed"].includes(discountType)) {
      return res.json({ success: false, message: "Invalid discount type" });
    }

    // Validate discount
    const discountValue = parseFloat(discount);
    if (isNaN(discountValue) || discountValue < 0) {
      return res.json({ success: false, message: "Discount must be a valid number >= 0" });
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      return res.json({ success: false, message: "Coupon not found" });
    }

    const existingCoupon = await Coupon.findOne({
      code: { $regex: new RegExp(`^${code.toUpperCase()}$`, "i") },
      _id: { $ne: id },
    });

    if (existingCoupon) {
      return res.json({ success: false, message: "Coupon code already exists" });
    }

    coupon.code = code.toUpperCase();
    coupon.discountType = discountType;
    coupon.discount = discountValue;
    coupon.minPurchase = parseFloat(minPurchase) || 0;
    coupon.maxDiscount = parseFloat(maxDiscount) || 0;
    coupon.expiryDate = new Date(expiryDate);
    coupon.isActive = isActive === "true" || isActive === true;

    await coupon.save();
    res.json({ success: true, message: "Coupon updated successfully" });
  } catch (error) {
    console.error("Error editing coupon:", error);
    res.json({ success: false, message: "Error editing coupon" });
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