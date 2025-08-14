import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import dotenv from "dotenv";
dotenv.config();

export const woo = new WooCommerceRestApi.default({
	url: process.env.WOO_URL,
	consumerKey: process.env.WOO_CONSUMER_KEY,
	consumerSecret: process.env.WOO_CONSUMER_SECRET,
	version: "wc/v3",
});
