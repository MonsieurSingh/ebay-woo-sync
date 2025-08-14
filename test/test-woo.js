import dotenv from "dotenv";
import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
dotenv.config();

const woo = new WooCommerceRestApi.default({
	url: process.env.WOO_URL,
	consumerKey: process.env.WOO_CONSUMER_KEY,
	consumerSecret: process.env.WOO_CONSUMER_SECRET,
	version: "wc/v3",
});

(async () => {
	try {
		const res = await woo.get("products", { per_page: 1 });
		console.log("✅ WooCommerce connected. Sample product:", res.data[0]);
	} catch (err) {
		console.error(
			"❌ WooCommerce connection failed:",
			err.response?.data || err.message
		);
	}
})();
