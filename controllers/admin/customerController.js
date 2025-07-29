const User = require("../../models/userSchema");

const customerInfo = async (req, res) => {
  try {
    let search = "";
    if (req.query.search) {
      search = req.query.search;
    }
    
    let page = 1;
    if (req.query.page) {
      page = parseInt(req.query.page);
    }
    
    const limit = 6;
    
    const userData = await User.find({
      isAdmin: false,
      $or: [
        { name: { $regex: ".*" + search + ".*", $options: 'i' } },
        { email: { $regex: ".*" + search + ".*", $options: 'i' } },
      ],
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip((page - 1) * limit)
    .exec();
    
    const count = await User.countDocuments({
      isAdmin: false,
      $or: [
        { name: { $regex: ".*" + search + ".*", $options: 'i' } },
        { email: { $regex: ".*" + search + ".*", $options: 'i' } },
      ],
    });
    
    
    console.log(userData.map(user => ({ id: user._id, phone: user.phone })));
    
    res.render('admin/customers', {
      customers: userData,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      search: search
    });
} catch (error) {
    console.error("Admin Error:", error);
    res.render("admin/admin-error", { errorMessage: "Something went wrong. Please try again later." });
}

};


const blockCustomer = async (req, res) => {
  try {
    const userId = req.params.id;
    await User.findByIdAndUpdate(userId, { isBlocked: true });
    res.json({ success: true, message: "User blocked successfully" });
  } catch (error) {
    console.error("Error blocking customer:", error);
    res.status(500).json({ success: false, message: "Failed to block user" });
  }
};


const unblockCustomer = async (req, res) => {
  try {
    const userId = req.params.id;
    await User.findByIdAndUpdate(userId, { isBlocked: false });
    res.json({ success: true, message: "User unblocked successfully" });
  } catch (error) {
    console.error("Error unblocking customer:", error);
    res.status(500).json({ success: false, message: "Failed to unblock user" });
  }
};

module.exports = {
  customerInfo,
  blockCustomer,
  unblockCustomer,
};