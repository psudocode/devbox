import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  base58Decode,
  base58Encode,
  domainToAscii,
  domainToUnicode,
  punycodeDecode,
  punycodeEncode,
} from "./logic";

const text = (s: string) => new TextEncoder().encode(s);
const hex = (h: string) => Uint8Array.from(h.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("Base32", () => {
  // RFC 4648 section 10
  const vectors: [string, string, string][] = [
    ["", "", ""],
    ["f", "MY======", "CO======"],
    ["fo", "MZXQ====", "CPNG===="],
    ["foo", "MZXW6===", "CPNMU==="],
    ["foob", "MZXW6YQ=", "CPNMUOG="],
    ["fooba", "MZXW6YTB", "CPNMUOJ1"],
    ["foobar", "MZXW6YTBOI======", "CPNMUOJ1E8======"],
  ];

  it("matches the RFC 4648 test vectors, standard and extended hex", () => {
    for (const [plain, std, ext] of vectors) {
      expect(base32Encode(text(plain), "rfc4648", true), plain).toBe(std);
      expect(base32Encode(text(plain), "hex", true), plain).toBe(ext);
      const back = base32Decode(std, "rfc4648");
      expect(back.ok && new TextDecoder().decode(back.bytes), plain).toBe(plain);
      const backHex = base32Decode(ext, "hex");
      expect(backHex.ok && new TextDecoder().decode(backHex.bytes), plain).toBe(plain);
    }
  });

  it("can leave out padding and reads it back", () => {
    expect(base32Encode(text("foobar"), "rfc4648", false)).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI", "rfc4648")).toMatchObject({ ok: true });
  });

  it("supports Crockford: no padding, O/I/L aliases, hyphens, lower case", () => {
    expect(base32Encode(text("foobar"), "crockford", true)).toBe("CSQPYRK1E8");
    const back = base32Decode("csqp-yrk1-e8", "crockford");
    expect(back.ok && new TextDecoder().decode(back.bytes)).toBe("foobar");
    const aliased = base32Decode("CSQPYRKIE8".replace("I", "L"), "crockford");
    expect(aliased.ok && new TextDecoder().decode(aliased.bytes)).toBe("foobar");
    expect(base32Decode("CSQPYRK1E8==", "crockford")).toMatchObject({ ok: false, error: expect.stringContaining("padding") });
  });

  it("round-trips arbitrary bytes", () => {
    const bytes = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) & 0xff);
    for (const variant of ["rfc4648", "hex", "crockford"] as const) {
      const back = base32Decode(base32Encode(bytes, variant, true), variant);
      expect(back.ok && toHex(back.bytes), variant).toBe(toHex(bytes));
    }
  });

  it("rejects bad characters, bad lengths, bad padding and non-canonical tails", () => {
    expect(base32Decode("MZXW6!", "rfc4648")).toMatchObject({ ok: false, error: expect.stringContaining('Invalid character "!"') });
    expect(base32Decode("MZXW1", "rfc4648")).toMatchObject({ ok: false }); // "1" is not in the RFC alphabet
    expect(base32Decode("MZX", "rfc4648")).toMatchObject({ ok: false, error: expect.stringContaining("valid length") });
    expect(base32Decode("MZXW6=", "rfc4648")).toMatchObject({ ok: false, error: expect.stringContaining("multiple of 8") });
    expect(base32Decode("MZ=XW6YT", "rfc4648")).toMatchObject({ ok: false, error: expect.stringContaining("only allowed at the end") });
    expect(base32Decode("MZ", "rfc4648")).toMatchObject({ ok: false, error: expect.stringContaining("non-zero padding bits") });
  });
});

describe("Base58", () => {
  // From the Bitcoin Core base58 test vectors.
  const vectors: [string, string][] = [
    ["", ""],
    ["61", "2g"],
    ["626262", "a3gV"],
    ["636363", "aPEr"],
    ["73696d706c792061206c6f6e6720737472696e67", "2cFupjhnEsSn59qHXstmK2ffpLv2"],
    ["00eb15231dfceb60925886b67d065299925915aeb172c06647", "1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L"],
    ["516b6fcd0f", "ABnLTmg"],
    ["bf4f89001e670274dd", "3SEo3LWLoPntC"],
    ["572e4794", "3EFU7m"],
    ["ecac89cad93923c02321", "EJDM8drfXA6uyA"],
    ["10c8511e", "Rt5zm"],
    ["00000000000000000000", "1111111111"],
  ];

  it("matches the Bitcoin test vectors both ways", () => {
    for (const [h, b58] of vectors) {
      expect(base58Encode(hex(h), "bitcoin"), h).toEqual({ ok: true, text: b58 });
      const back = base58Decode(b58, "bitcoin");
      expect(back.ok && toHex(back.bytes), b58).toBe(h);
    }
  });

  it("supports the Flickr and Ripple alphabets", () => {
    const flickr = base58Encode(text("hello"), "flickr");
    const ripple = base58Encode(text("hello"), "ripple");
    const bitcoin = base58Encode(text("hello"), "bitcoin");
    expect(bitcoin).toEqual({ ok: true, text: "Cn8eVZg" });
    expect(flickr.ok && flickr.text).not.toBe("Cn8eVZg");
    for (const [name, r] of [["flickr", flickr], ["ripple", ripple]] as const) {
      expect(r.ok, name).toBe(true);
      if (r.ok) {
        const back = base58Decode(r.text, name);
        expect(back.ok && new TextDecoder().decode(back.bytes)).toBe("hello");
      }
    }
  });

  it("explains the look-alike characters Base58 leaves out", () => {
    expect(base58Decode("2g0", "bitcoin")).toMatchObject({ ok: false, error: expect.stringContaining("leaves out 0, O, I and l") });
    expect(base58Decode("a b", "bitcoin")).toMatchObject({ ok: true }); // whitespace is ignored: "ab"
  });

  it("limits the input size", () => {
    expect(base58Encode(new Uint8Array(9000), "bitcoin")).toMatchObject({ ok: false });
  });
});

describe("Punycode", () => {
  it("matches known labels", () => {
    expect(punycodeEncode("münchen")).toBe("mnchen-3ya");
    expect(punycodeEncode("bücher")).toBe("bcher-kva");
    expect(punycodeEncode("日本語")).toBe("wgv71a119e");
    expect(punycodeEncode("例え")).toBe("r8jz45g");
    expect(punycodeEncode("abc")).toBe("abc-");
    expect(punycodeEncode("")).toBe("");
    // RFC 3492 section 7.1 (A) Arabic and (B) Chinese
    expect(punycodeEncode("ليهمابتكلموشعربي؟")).toBe("egbpdaj6bu4bxfgehfvwxn");
    expect(punycodeEncode("他们为什么不说中文")).toBe("ihqwcrb4cv8a8dqg056pqjye");
  });

  it("decodes them back", () => {
    expect(punycodeDecode("mnchen-3ya")).toEqual({ ok: true, text: "münchen" });
    expect(punycodeDecode("wgv71a119e")).toEqual({ ok: true, text: "日本語" });
    expect(punycodeDecode("egbpdaj6bu4bxfgehfvwxn")).toEqual({ ok: true, text: "ليهمابتكلموشعربي؟" });
    expect(punycodeDecode("abc-")).toEqual({ ok: true, text: "abc" });
    // Digits are case-insensitive; the plain ASCII part keeps its case.
    expect(punycodeDecode("MNCHEN-3YA")).toEqual({ ok: true, text: "MüNCHEN" });
    expect(punycodeDecode("mnchen-3YA")).toEqual({ ok: true, text: "münchen" });
  });

  it("round-trips mixed and astral text", () => {
    for (const s of ["🐙", "a🐙b", "Pelé-日本-🐙", "ÅÄÖ", "x"]) {
      const encoded = punycodeEncode(s);
      expect(punycodeDecode(encoded), s).toEqual({ ok: true, text: s });
    }
  });

  it("rejects malformed Punycode", () => {
    expect(punycodeDecode("ab!-xx")).toMatchObject({ ok: false });
    expect(punycodeDecode("mnchen-3y!")).toMatchObject({ ok: false, error: expect.stringContaining("not a valid Punycode character") });
    expect(punycodeDecode("mnchen-3")).toMatchObject({ ok: false, error: expect.stringContaining("middle of a number") });
    expect(punycodeDecode("é-abc")).toMatchObject({ ok: false, error: expect.stringContaining("plain ASCII") });
    expect(punycodeDecode("99999999999999999")).toMatchObject({ ok: false });
  });
});

describe("domains", () => {
  it("converts to the xn-- form and back, label by label", () => {
    expect(domainToAscii("münchen.de")).toEqual({ text: "xn--mnchen-3ya.de", warnings: [] });
    expect(domainToAscii("例え.jp")).toEqual({ text: "xn--r8jz45g.jp", warnings: [] });
    expect(domainToAscii("www.日本語.co.jp").text).toBe("www.xn--wgv71a119e.co.jp");
    expect(domainToAscii("example.com").text).toBe("example.com");
    expect(domainToAscii("Example.COM").text).toBe("example.com");
    expect(domainToUnicode("xn--mnchen-3ya.de")).toEqual({ text: "münchen.de", warnings: [] });
    expect(domainToUnicode("WWW.XN--WGV71A119E.CO.JP").text).toBe("WWW.日本語.CO.JP");
  });

  it("normalizes case, composition and ideographic dots", () => {
    expect(domainToAscii("MÜNCHEN.DE").text).toBe("xn--mnchen-3ya.de");
    expect(domainToAscii("münchen.de").text).toBe("xn--mnchen-3ya.de"); // u + combining diaeresis
    expect(domainToAscii("例え。jp").text).toBe("xn--r8jz45g.jp");
  });

  it("warns about labels that are too long and keeps bad xn-- labels", () => {
    const long = domainToAscii(`${"é".repeat(80)}.com`);
    expect(long.warnings[0]).toMatch(/at most 63/);
    const bad = domainToUnicode("xn--!!.com");
    expect(bad.text).toBe("xn--!!.com");
    expect(bad.warnings[0]).toMatch(/xn--!!/);
  });
});
