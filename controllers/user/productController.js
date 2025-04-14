const User = require("../../models/userSchema");
const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");

// Price ranges configuration
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

    const categoryIds = categories.map((cat) => cat._id.toString());
    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const skip = (page - 1) * limit;
    
    // Extract filter parameters
    const searchQuery = req.query.query || '';
    const sortOption = req.query.sort || '';
    const priceFilter = req.query.price || '';
    const categoryFilter = req.query.category || '';

    // Base query for products
    let query = {
      isBlocked: false,
      category: { $in: categoryIds },
      // quantity: { $gt: 0 }
    };

    // Search functionality
    if (searchQuery) {
      query.$or = [
        { productName: { $regex: searchQuery, $options: 'i' } },
        { description: { $regex: searchQuery, $options: 'i' } }
      ];
    }

    // Price filter functionality
    if (priceFilter) {
      const selectedRange = PRICE_RANGES.find(range => range.label === priceFilter);
      if (selectedRange) {
        query.salesPrice = { 
          $gte: selectedRange.min, 
          $lte: selectedRange.max 
        };
      }
    }

    // Category filter
    if (categoryFilter) {
      query.category = categoryFilter;
    }

    // Sorting logic with comprehensive options
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

    // Get total products count
    const totalProducts = await Product.countDocuments(query);

    // Fetch products with sorting and pagination
    const products = await Product.find(query)
      .lean()
      .sort(sortCriteria)
      .skip(skip)
      .limit(limit);

    // Process products to ensure image
    const processedProducts = products.map(product => ({
      ...product,
      productImage: product.productImage && product.productImage.length > 0 
        ? product.productImage 
        : ["default-image.jpg"]
    }));

    const totalPages = Math.ceil(totalProducts / limit);

    res.render('user/shop', {
      user: userData,
      products: processedProducts,
      category: categories,
      totalProducts,
      currentPage: page,
      totalPages,
      sort: sortOption,
      query: searchQuery,
      price: priceFilter,
      selectedCategory: categoryFilter
    });
  } catch (error) {
    console.error("Error loading shop page:", error.message);
    res.status(500).redirect('/pageNotFound');
  }
};


const productDetails =async(req,res)=>{
  try {
    // const userId=req.session.user;
    // const userData=await User.findById(userId)
    const productId=req.query.id;
    const product = await Product.findById(productId).populate('category');
    const findCategory=product.category;
    const categoryOffer=findCategory?.categoryOffer || 0;
    const productOffer=product.productOffer || 0;
    const totalOffer=categoryOffer+productOffer;
    res.render("user/productDetails", {
      product: product,
      quantity: product.quantity,
      totalOffer: totalOffer,
      category: findCategory,
  });
  } catch (error) {

    res.redirect("/pageNotFound")
    
  }
}

module.exports = {
  loadShoppingPage,
 productDetails
  // logFilterParams
};