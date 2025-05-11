

const mongoose = require("mongoose");
const { Schema } = mongoose;

const wishlistschema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    products: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: "product",
          required: true,
        },
        addedOn: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true },
);
const Wishlist = mongoose.model("Wishlist", wishlistschema);

module.exports = Wishlist;

