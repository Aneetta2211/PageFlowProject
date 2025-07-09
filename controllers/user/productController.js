const mongoose = require('mongoose');
const User = require('../../models/userSchema');
const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Wishlist = require('../../models/wishlistSchema');

const PRICE_RANGES = [
  { label: 'under-500', min: 0, max: 500 },
  { label: '500-1000', min: 500, max: 1000 },
  { label: '1000-1500', min: 1000, max: 1500 },
  { label: 'above-1500', min: 1500, max: Number.MAX_SAFE_INTEGER }
];

const loadShoppingPage = async (req, res) => {
  try {
    if (!req.session.user || !req.session.user.id) {
      return res.redirect('/login');
    }

    const userId = req.session.user.id;
    const userData = await User.findById(userId);

    if (!userData) {
      return res.redirect('/login');
    }

    const categories = await Category.find({ isListed: true });
    if (!categories || categories.length === 0) {
      return res.redirect('/pageNotFound');
    }

    const wishlist = await Wishlist.findOne({ userId }).lean() || { products: [] };

    const categoryIds = categories.map((cat) => cat._id.toString());
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;

    const searchQuery = req.query.query || '';
    const sortOption = req.query.sort || '';
    const priceFilter = req.query.price || '';
    const categoryFilter = req.query.category || '';

    let query = {
      isBlocked: false,
      category: { $in: categoryIds },
    };

    if (searchQuery) {
      query.$or = [
        { productName: { $regex: searchQuery, $options: 'i' } },
      ];
    }

    if (priceFilter) {
      const selectedRange = PRICE_RANGES.find(range => range.label === priceFilter);
      if (selectedRange) {
        query.salesPrice = { 
          $gte: selectedRange.min, 
          $lte: selectedRange.max 
        };
      }
    }

    if (categoryFilter) {
      query.category = categoryFilter;
    }

    const sortCriteriaMap = {
      'price-low-high': { salesPrice: 1 },
      'price-high-low': { salesPrice: -1 },
      'name-asc': { productName: 1 },
      'name-desc': { productName: -1 },
      'popularity': { quantity: -1 },
      'ratings': { averageRating: -1 },
      'new-arrivals': { createdAt: -1 },
      'featured': { productOffer: -1 },
      'default': { createdAt: -1 }
    };

    const sortCriteria = sortCriteriaMap[sortOption] || sortCriteriaMap['default'];

    const totalProducts = await Product.countDocuments(query);

    const products = await Product.find(query)
      .populate('category')
      .lean()
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit);

    const processedProducts = products.map(product => {
  const categoryOffer = product.category?.categoryOffer || 0;
  const productOffer = product.productOffer || 0;
  const totalOffer = Math.max(categoryOffer, productOffer);
  const offerType = categoryOffer > productOffer ? 'category' : (productOffer > categoryOffer ? 'product' : 'none');
  const regularPrice = parseFloat(product.regularPrice) || 0;
  const discountedPrice = regularPrice - (regularPrice * totalOffer / 100);

  const stockStatus = product.quantity <= 0 ? 'out of stock' : 'in stock';

  return {
    ...product,
    productImage: product.productImage && product.productImage.length > 0 
      ? product.productImage 
      : ["default-image.jpg"],
    totalOffer: totalOffer,
    offerType,
    discountedPrice: discountedPrice.toFixed(2),
    showOffer: totalOffer > 0,
    finalPrice: discountedPrice.toFixed(2),
    salesPrice: discountedPrice.toFixed(2),
    status: stockStatus   
  };
});

    const totalPages = Math.ceil(totalProducts / limit);

    res.render('user/shop', {
      user: userData,
      wishlistItems: wishlist,
      products: processedProducts,
      category: categories,
      totalProducts,
      currentPage: page,
      totalPages,
      sort: sortOption,
      query: searchQuery,
      price: priceFilter,
      selectedCategory: categoryFilter,
      selectedSort: sortOption,
      selectedQuery: searchQuery,
      selectedPrice: priceFilter,
    });
  } catch (error) {
    console.error("Error loading shop page:", error.message);
    res.status(500).redirect('/login');
  }
};

const productDetails = async (req, res) => {
  try {
    const productId = req.params.productId;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).redirect('/login');
    }

    const product = await Product.findById(productId).populate('category');
    if (!product || product.isBlocked || product.status === 'out of stock') {
      return res.status(404).redirect('/pageNotFound');
    }

    const findCategory = product.category;
    if (!findCategory || !findCategory.isListed) {
      return res.status(404).redirect('/pageNotFound');
    }

    const categoryOffer = findCategory?.categoryOffer || 0;
    const productOffer = product.productOffer || 0;
    const totalOffer = Math.max(categoryOffer, productOffer);
    const offerType = categoryOffer > productOffer ? 'category' : (productOffer > 0 ? 'product' : 'none');
    
    const regularPrice = parseFloat(product.regularPrice) || 0;
    const discountedPrice = regularPrice - (regularPrice * totalOffer / 100);

    let wishlistItems = null;
    const userId = req.session.user?._id || req.session.user?.id;
    if (userId) {
      wishlistItems = await Wishlist.findOne({ userId }).lean() || { products: [] };
      console.log('WishlistItems in productDetails:', JSON.stringify(wishlistItems, null, 2));
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.render("user/productDetails", {
      product: {
        ...product.toObject(),
        salesPrice: discountedPrice.toFixed(2),
        finalPrice: discountedPrice.toFixed(2),
        discountedPrice: discountedPrice.toFixed(2)
      },
      category: findCategory,
      totalOffer,
      offerType,
      wishlistItems
    });
  } catch (error) {
    console.error("Error loading product details:", error.message);
    res.status(500).redirect('/pageNotFound');
  }
};

module.exports = {
  loadShoppingPage,
  productDetails
};