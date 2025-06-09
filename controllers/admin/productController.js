const mongoose = require('mongoose');
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const User = require("../../models/userSchema");
const Order = require("../../models/orderSchema");


const calculateProductPricing = (product, category) => {
  const categoryOffer = category?.categoryOffer || 0;
  const productOffer = product?.productOffer || 0;
  const maxDiscountPercentage = Math.max(categoryOffer, productOffer);
  const regularPrice = parseFloat(product?.regularPrice) || 0;
  
  const salesPrice = maxDiscountPercentage > 0
    ? regularPrice - (regularPrice * maxDiscountPercentage / 100)
    : regularPrice;

  return {
    categoryOffer,
    productOffer,
    totalOffer: maxDiscountPercentage,
    offerType: maxDiscountPercentage > 0
      ? (categoryOffer > productOffer ? 'category' : 'product')
      : 'none',
    salesPrice: Number(salesPrice.toFixed(2)),
    discountedPrice: Number(salesPrice.toFixed(2))
  };
};

const getProductAddPage = async (req, res) => {
  try {
    const category = await Category.find({ isListed: true });
    res.render("admin/add-product", {
      category: category,
      currentRoute: 'add-product'
    });
  } catch (error) {
    console.error("Error in getProductAddPage:", error);
    res.redirect("/pageerror");
  }
};


const addProduct = async (req, res) => {
  try {
    const { productName, category, description, regularPrice, salesPrice, quantity, productOffer } = req.body;
    const images = req.files ? req.files.map(file => `/uploads/products/${file.filename}`) : [];

    if (!productName || !category || !description || !regularPrice || 
        !salesPrice || quantity === undefined || quantity === null || !images.length) {
      throw new Error("All required fields must be provided");
    }

    if (images.length > 4) {
      throw new Error("Cannot upload more than 4 images");
    }

    const regularPriceNum = parseFloat(regularPrice);
    const salesPriceNum = parseFloat(salesPrice);
    const productOfferNum = parseInt(productOffer) || 0;

   
    if (salesPriceNum > regularPriceNum) {
      throw new Error("Sale price must be less than or equal to regular price");
    }

    if (isNaN(productOfferNum) || productOfferNum < 0 || productOfferNum > 100) {
      throw new Error("Product offer must be between 0 and 100");
    }

    const categoryData = await Category.findById(category);
    if (!categoryData) {
      throw new Error("Category not found");
    }

    const pricing = calculateProductPricing(
      { regularPrice: regularPriceNum, productOffer: productOfferNum },
      categoryData
    );

    
    const finalSalesPrice = pricing.offerType === 'none' ? salesPriceNum : pricing.salesPrice;

    const newProduct = new Product({
      productName,
      category,
      description,
      regularPrice: regularPriceNum,
      salesPrice: finalSalesPrice,
      quantity: parseInt(quantity),
      productImage: images,
      productOffer: productOfferNum,
      totalOffer: pricing.totalOffer,
      offerType: pricing.offerType,
      status: parseInt(quantity) === 0 ? "out of stock" : "Available"
    });

    const savedProduct = await newProduct.save();
    console.log("Product saved:", savedProduct);

    req.session.successMessage = "Product added successfully!";
    res.redirect("/admin/products");
  } catch (error) {
    console.error("Error adding product:", error.message);
    req.session.errorMessage = error.message; 
    res.redirect("/admin/add-product"); 
  }
};


const getAllProducts = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 4;

    const query = {
      $or: [
        { productName: new RegExp(search, 'i') },
        { 'category.name': new RegExp(search, 'i') }
      ]
    };

    const products = await Product.find(query)
      .populate('category')
      .skip((page - 1) * limit)
      .limit(limit);

    
    const processedProducts = products.map(product => {
      const pricing = calculateProductPricing(product, product.category || {});
      return {
        ...product.toObject(),
        categoryOffer: pricing.categoryOffer,
        productOffer: pricing.productOffer,
        totalOffer: pricing.totalOffer,
        offerType: pricing.offerType,
        salesPrice: pricing.salesPrice,
        discountedPrice: pricing.discountedPrice
      };
    });

    const total = await Product.countDocuments(query);
    const totalPages = Math.ceil(total / limit);

    const successMessage = req.session.successMessage || null;
    delete req.session.successMessage;

    res.render('admin/products', {
      products: processedProducts || [],
      search: search,
      currentPage: page,
      totalPages: totalPages,
      successMessage: successMessage
    });
  } catch (error) {
    console.error('Error in getAllProducts:', error);
    res.redirect("/pageerror");
  }
};

const getEditProductPage = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findById(productId).populate('category');
    const categories = await Category.find({ isListed: true });

    if (!product) {
      throw new Error("Product not found");
    }

    
    const pricing = calculateProductPricing(product, product.category || {});

    res.render("admin/edit-product", {
      product: {
        ...product.toObject(),
        categoryOffer: pricing.categoryOffer,
        productOffer: pricing.productOffer,
        totalOffer: pricing.totalOffer,
        offerType: pricing.offerType,
        salesPrice: pricing.salesPrice,
        discountedPrice: pricing.discountedPrice
      },
      category: categories,
      currentRoute: 'edit-product',
    });
  } catch (error) {
    console.error("Error in getEditProductPage:", error);
    res.redirect("/pageerror");
  }
};


const updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const { productName, category, description, regularPrice, quantity, isBlocked, existingImages, removedImages, productOffer } = req.body;
    const newImages = req.files ? req.files.map(file => `/uploads/products/${file.filename}`) : [];

    const product = await Product.findById(productId).populate('category');
    if (!product) {
      throw new Error("Product not found");
    }

    let currentImages = Array.isArray(existingImages) ? existingImages : existingImages ? [existingImages] : [];
    const imagesToRemove = Array.isArray(removedImages) ? removedImages : removedImages ? [removedImages] : [];
    currentImages = currentImages.filter(img => !imagesToRemove.includes(img));

    const updatedImages = [...currentImages, ...newImages];
    if (updatedImages.length < 3) {
      req.session.warningMessage = "You must have at least 3 product images.";
      return res.redirect(`/admin/products/edit/${productId}`);
    }

    const categoryData = await Category.findById(category);
    if (!categoryData) {
      throw new Error("Category not found");
    }

    const productOfferNum = parseInt(productOffer) || 0;
    if (isNaN(productOfferNum) || productOfferNum < 0 || productOfferNum > 100) {
      throw new Error("Product offer must be between 0 and 100");
    }

    const pricing = calculateProductPricing(
      { 
        regularPrice: parseFloat(regularPrice), 
        productOffer: productOfferNum 
      }, 
      categoryData
    );

    const updateData = {
      productName,
      category,
      description,
      regularPrice: parseFloat(regularPrice),
      salesPrice: pricing.salesPrice,
      quantity: parseInt(quantity),
      isBlocked: isBlocked === 'true',
      productImage: updatedImages,
      productOffer: productOfferNum,
      totalOffer: pricing.totalOffer,
      offerType: pricing.offerType,
      status: parseInt(quantity) === 0 ? "out of stock" : "Available",
    };

    const updatedProduct = await Product.findByIdAndUpdate(productId, updateData, { new: true });
    if (!updatedProduct) {
      throw new Error("Product not found");
    }

    req.session.successMessage = "Product updated successfully!";
    res.redirect("/admin/products");
  } catch (error) {
    console.error("Error updating product:", error);
    res.redirect("/pageerror");
  }
};


const blockProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findByIdAndUpdate(
      productId,
      { isBlocked: true },
      { new: true }
    );

    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Error blocking product:", error);
    res.json({ success: false, message: "Failed to delete product" });
  }
};

const unblockProduct = async (req, res) => {
  try {
    const productId = req.params.id;
    const product = await Product.findByIdAndUpdate(
      productId,
      { isBlocked: false },
      { new: true }
    );

    if (!product) {
      return res.json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, message: "Product restored successfully" });
  } catch (error) {
    console.error("Error unblocking product:", error); 
    res.json({ success: false, message: "Failed to restore product" });
  }
};

const loadProfile = async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.id) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.user.id);
    if (!user) {
      return res.redirect('/login');
    }

    const orders = await Order.find({ user: req.session.user.id });
    res.render('user/profile', {
      section: req.query.section || 'overview',
      user: {
        name: user.name || 'Unknown',
        email: user.email || '',
        phone: user.phone || '',
        profileImage: user.profileImage || 'https://via.placeholder.com/150',
        addresses: user.addresses || []
      },
      orders: orders || [],
      otpSent: req.session.otpSent || false
    });
  } catch (error) {
    console.error('Error in loadProfile:', error);
    res.redirect('/pageNotFound');
  }
};


const manageProductOffer = async (req, res, action) => {
  try {
    const { productId, offerPercentage } = req.body;
    console.log(`Processing ${action} offer for product: ${productId}, Offer: ${offerPercentage}, Session: ${req.session.admin ? 'present' : 'missing'}`);

   
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      console.error(`Invalid productId: ${productId}`);
      return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

   
    const product = await Product.findById(productId).populate('category');
    if (!product) {
      console.error(`Product not found: ${productId}`);
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (!product.category) {
      console.error(`Category not found for product: ${productId}`);
      return res.status(400).json({ success: false, message: 'Product category not found' });
    }

   
    let offer = 0;
    if (action === 'add') {
      offer = parseInt(offerPercentage);
      if (isNaN(offer) || offer < 0 || offer > 100) {
        console.error(`Invalid offer percentage: ${offerPercentage}`);
        return res.status(400).json({ success: false, message: 'Offer percentage must be between 0 and 100' });
      }
    }

  
    product.productOffer = action === 'add' ? offer : 0;
    const pricing = calculateProductPricing(product, product.category);

   
    product.salesPrice = pricing.salesPrice;
    product.totalOffer = pricing.totalOffer;
    product.offerType = pricing.offerType;

    
    await product.save();
    console.log(`Product offer ${action === 'add' ? 'applied' : 'removed'} successfully: ${productId}`);

    
    return res.json({
      success: true,
      productOffer: product.productOffer,
      totalOffer: pricing.totalOffer,
      offerType: pricing.offerType,
      salesPrice: pricing.salesPrice,
      message: action === 'add' ? 'Product offer applied successfully' : 'Product offer removed successfully'
    });
  } catch (error) {
    console.error(`Error ${action === 'add' ? 'adding' : 'removing'} product offer:`, error.message);
    return res.status(500).json({ success: false, message: 'Server error while processing offer' });
  }
};




const addProductOffer = async (req, res) => {
  return manageProductOffer(req, res, 'add');
};

const removeProductOffer = async (req, res) => {
  return manageProductOffer(req, res, 'remove');
};

module.exports = {
  getProductAddPage,
  addProduct,
  getAllProducts,
  getEditProductPage,
  updateProduct,
  blockProduct,
  unblockProduct,
  loadProfile,
  addProductOffer,
  removeProductOffer
};