// // const mongoose = require("mongoose");
// // const { Schema } = mongoose;

// // const userSchema = new Schema(
// //   {
// //     name: {
// //       type: String,
// //       required: true,
// //     },
// //     email: {
// //       type: String,
// //       required: true,
// //       unique: true,
// //     },
// //     phone: {
// //       type: String,
// //       required: false,
// //       unique: false,
// //       // sparse: true,
// //       // default: null,
// //     },
    
// //     googleId: {
// //       type: String,
// //       unique: true,
// //       sparse: true,
// //     },
// //     password: {
// //       type: String,
// //       required: false,
// //     },
// //     isBlocked: {
// //       type: Boolean,
// //       default: false,
// //     },
// //     isAdmin: {
// //       type: Boolean,
// //       default: false,
// //     },
// //     cart: [
// //       {
// //         type: Schema.Types.ObjectId,
// //         ref: "Cart",
// //       },
// //     ],
// //     wallet: {
// //       type: Number,
// //       default: 0,
// //     },
// //     wishlist: [
// //       {
// //         type: Schema.Types.ObjectId,
// //         ref: "Wishlist",  
// //       },
// //     ],
// //     orderHistory: [
// //       {
// //         type: Schema.Types.ObjectId,
// //         ref: "Order",
// //       },
// //     ],
// //     referalCode: {
// //       type: String,
// //     },
// //     redeemed: {
// //       type: Boolean,
// //     },
// //     redeemedUsers: [
// //       {
// //         type: Schema.Types.ObjectId,
// //         ref: "User",
// //       },
// //     ],
// //     searchHistory: [
// //       {
// //         category: {
// //           type: Schema.Types.ObjectId,
// //           ref: "category",
// //         },
// //         brand: {
// //           type: String,
// //         },
// //         searchOn: {
// //           type: Date,
// //           default: Date.now,
// //         },
// //       },
// //     ],
// //   },
// //   { timestamps: true }
// // );

// // const User = mongoose.model("User", userSchema);

// // module.exports = User;


// const mongoose = require("mongoose");
// const { Schema } = mongoose;

// const userSchema = new Schema(
//   {
//     name: {
//       type: String,
//       required: true,
//     },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//     },
//     phone: {
//       type: String,
//       required: false,
//       unique: false,
//     },
//     googleId: {
//       type: String,
//       unique: true,
//       sparse: true,
//     },
//     password: {
//       type: String,
//       required: false,
//     },
//     isBlocked: {
//       type: Boolean,
//       default: false,
//     },
//     isAdmin: {
//       type: Boolean,
//       default: false,
//     },
//     cart: [
//       {
//         type: Schema.Types.ObjectId,
//         ref: "Cart",
//       },
//     ],
//     wallet: {
//       type: Number,
//       default: 0,
//     },
//     wishlist: [
//       {
//         type: Schema.Types.ObjectId,
//         ref: "Wishlist",
//       },
//     ],
//     orderHistory: [
//       {
//         type: Schema.Types.ObjectId,
//         ref: "Order",
//       },
//     ],
//     referalCode: {
//       type: String,
//     },
//     redeemed: {
//       type: Boolean,
//     },
//     redeemedUsers: [
//       {
//         type: Schema.Types.ObjectId,
//         ref: "User",
//       },
//     ],
//     searchHistory: [
//       {
//         category: {
//           type: Schema.Types.ObjectId,
//           ref: "category",
//         },
//         brand: {
//           type: String,
//         },
//         searchOn: {
//           type: Date,
//           default: Date.now,
//         },
//       },
//     ],
//     profileImage: {
//       type: String,
//       default: '/images/default-profile.png',
//     },
//   },
//   { timestamps: true }
// );

// const User = mongoose.model("User", userSchema);

// module.exports = User;


const mongoose = require("mongoose");
const { Schema } = mongoose;
const shortid = require("shortid"); // Added for generating unique referral codes

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
      required: false,
      unique: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },
    password: {
      type: String,
      required: false,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    isAdmin: {
      type: Boolean,
      default: false,
    },
    cart: [
      {
        type: Schema.Types.ObjectId,
        ref: "Cart",
      },
    ],
    wallet: {
      type: Number,
      default: 0,
    },
    wishlist: [
      {
        type: Schema.Types.ObjectId,
        ref: "Wishlist",
      },
    ],
    orderHistory: [
      {
        type: Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    referalCode: {
      type: String,
      unique: true,
      default: () => shortid.generate(), // Automatically generate a unique referral code
    },
    redeemed: {
      type: Boolean,
      default: false, // Added default value for consistency
    },
    redeemedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    searchHistory: [
      {
        category: {
          type: Schema.Types.ObjectId,
          ref: "category",
        },
        brand: {
          type: String,
        },
        searchOn: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    profileImage: {
      type: String,
      default: "/images/default-profile.png",
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

module.exports = User;