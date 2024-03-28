import { readContract } from "../../../../../transaction/read-contract.js";
import type { BaseTransactionOptions } from "../../../../../transaction/types.js";

import { decodeAbiParameters } from "viem";
import type { Hex } from "../../../../../utils/encoding/hex.js";

const FN_SELECTOR = "0x40df0ba0" as const;
const FN_INPUTS = [] as const;
const FN_OUTPUTS = [
  {
    type: "uint256",
  },
] as const;

/**
 * Decodes the result of the usdUnitPrice function call.
 * @param result - The hexadecimal result to decode.
 * @returns The decoded result as per the FN_OUTPUTS definition.
 * @extension FARCASTER
 * @example
 * ```ts
 * import { decodeUsdUnitPriceResult } from "thirdweb/extensions/farcaster";
 * const result = decodeUsdUnitPriceResult("...");
 * ```
 */
export function decodeUsdUnitPriceResult(result: Hex) {
  return decodeAbiParameters(FN_OUTPUTS, result)[0];
}

/**
 * Calls the "usdUnitPrice" function on the contract.
 * @param options - The options for the usdUnitPrice function.
 * @returns The parsed result of the function call.
 * @extension FARCASTER
 * @example
 * ```ts
 * import { usdUnitPrice } from "thirdweb/extensions/farcaster";
 *
 * const result = await usdUnitPrice();
 *
 * ```
 */
export async function usdUnitPrice(options: BaseTransactionOptions) {
  return readContract({
    contract: options.contract,
    method: [FN_SELECTOR, FN_INPUTS, FN_OUTPUTS] as const,
    params: [],
  });
}
