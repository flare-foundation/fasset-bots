import BN from "bn.js";

//convert USD string to BN
export function usdStringToBN(value: string): BN {
    const sanitizedValue = value.replace(/,/g, "");
    const [integerPart, decimalPart = ""] = sanitizedValue.split(".");
    return new BN(integerPart + decimalPart.padEnd(3, "0"), 10);
}

//convert BN back to a USD string
export function bnToUsdString(bn: BN): string {
    const bnString = bn.toString();
    const integerPart = bnString.slice(0, -3) || "0";
    const decimalPart = bnString.slice(-3).padEnd(3, "0");

    // Add commas for thousands in integer part
    const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${formattedIntegerPart}.${decimalPart}`;
}

// sum two USD strings
export function sumUsdStrings(usd1: string, usd2: string): string {
    const bn1 = usdStringToBN(usd1);
    const bn2 = usdStringToBN(usd2);

    const totalBN = bn1.add(bn2);

    return bnToUsdString(totalBN);
}