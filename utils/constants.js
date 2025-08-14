import dotenv from "dotenv";
import minimist from "minimist";

dotenv.config();

export const args = minimist(process.argv.slice(2), {
	boolean: ["offers", "publish", "dry-run"],
	default: { "page-size": 100, limit: 0 },
});
export const LIMIT = Number(args.limit) || 0;
export const DRY_RUN = !!args["dry-run"];
export const CREATE_OFFERS = !!args.offers;
export const PUBLISH_OFFERS = !!args.publish;
export const PAGE_SIZE = Number(args["page-size"]) || 100;

export const EBAY_ENV =
	process.env.EBAY_ENV === "sandbox" ? "sandbox" : "production";
export const EBAY_BASE =
	EBAY_ENV === "sandbox"
		? "https://api.sandbox.ebay.com"
		: "https://api.ebay.com";

export const EBAY_MARKETPLACE_ID = process.env.EBAY_MARKETPLACE_ID || "EBAY_AU";
export const EBAY_CURRENCY = process.env.EBAY_CURRENCY || "AUD";
// export const EBAY_LOCATION_KEY = process.env.EBAY_LOCATION_KEY || "default-au";
