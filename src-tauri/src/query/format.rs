//! Cell formatting per PG type.
//!
//! `cell_to_string` is the per-cell adapter the result-grid renders. It
//! preserves NULLs as `None` and falls back to a `<{type}>` placeholder for
//! types we don't natively format yet (arrays, ENUMs, custom).
//!
//! Type matrix:
//!
//! | PG name              | Mapped via                                |
//! |----------------------|-------------------------------------------|
//! | `bool`               | `Option<bool>` → "true"/"false"           |
//! | `int2/int4/int8`     | `Option<i16/i32/i64>` → `to_string`       |
//! | `float4/float8`      | `Option<f32/f64>` → `to_string`           |
//! | `numeric`            | `Option<PgNumericString>` (binary parse)  |
//! | `text/varchar/...`   | `Option<String>`                          |
//! | `uuid`               | `Option<uuid::Uuid>` → `to_string`        |
//! | `timestamp`          | `Option<NaiveDateTime>` → space format    |
//! | `timestamptz`        | `Option<DateTime<Utc>>` → RFC3339         |
//! | `date`               | `Option<NaiveDate>` → ISO 8601            |
//! | `json/jsonb`         | `Option<serde_json::Value>` → compact     |
//! | _otherwise_          | `Some("<{type_name}>")`                   |

use std::fmt::Write as _;

use tokio_postgres::types::{FromSql, Type};
use tokio_postgres::Row;

/// Render a single cell from `row` at `idx` as `Option<String>`.
///
/// `None` is reserved for SQL NULL — every other code path returns `Some(_)`,
/// even unsupported types (which surface as `<{type}>` placeholders so the UI
/// can still render the row instead of failing the whole query).
#[must_use]
pub fn cell_to_string(row: &Row, idx: usize) -> Option<String> {
    let col = &row.columns()[idx];
    let type_name = col.type_().name();
    match type_name {
        "bool" => row
            .try_get::<_, Option<bool>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "int2" => row
            .try_get::<_, Option<i16>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "int4" => row
            .try_get::<_, Option<i32>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "int8" => row
            .try_get::<_, Option<i64>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "float4" => row
            .try_get::<_, Option<f32>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "float8" => row
            .try_get::<_, Option<f64>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "numeric" => row
            .try_get::<_, Option<PgNumericString>>(idx)
            .ok()
            .flatten()
            .map(|v| v.0),
        "text" | "varchar" | "char" | "name" | "bpchar" => {
            row.try_get::<_, Option<String>>(idx).ok().flatten()
        }
        "uuid" => row
            .try_get::<_, Option<uuid::Uuid>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "timestamp" => row
            .try_get::<_, Option<chrono::NaiveDateTime>>(idx)
            .ok()
            .flatten()
            .map(|v| v.format("%Y-%m-%d %H:%M:%S%.f").to_string()),
        "timestamptz" => row
            .try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_rfc3339()),
        "date" => row
            .try_get::<_, Option<chrono::NaiveDate>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "json" | "jsonb" => row
            .try_get::<_, Option<serde_json::Value>>(idx)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        other => Some(format!("<{other}>")),
    }
}

/// Predicate the result grid uses to right-align numeric columns. Includes
/// `numeric` now that arbitrary-precision values render as decimal strings
/// instead of the `<numeric>` placeholder ().
#[must_use]
pub fn is_numeric_type(type_name: &str) -> bool {
    matches!(        type_name,
        "int2" | "int4" | "int8" | "float4" | "float8" | "numeric"
)
}

/// Newtype that decodes `PostgreSQL`'s binary `NUMERIC` wire format to a
/// canonical decimal string.
///
/// `tokio-postgres` does not ship a built-in `FromSql` for `NUMERIC` — the
/// usual route is the `rust_decimal` / `bigdecimal` crates with a feature
/// gate, both of which would add a network-fetched dependency. PG's binary
/// format is small enough to parse inline (header: ndigits / weight / sign /
/// dscale, then `ndigits` base-10000 digits as `i16`) so we keep the
/// dependency footprint flat and avoid the precision ceiling that `Decimal`
/// imposes.
pub struct PgNumericString(pub String);

impl<'a> FromSql<'a> for PgNumericString {
    fn from_sql(        _ty: &Type,
        raw: &'a [u8],
) -> Result<Self, Box<dyn std::error::Error + Sync + Send>> {
        let s = format_pg_numeric_binary(raw)?;
        Ok(Self(s))
    }

    fn accepts(ty: &Type) -> bool {
        ty.name() == "numeric"
    }
}

const NBASE_DIGITS: u32 = 4; // each base-10000 digit prints as 4 decimal digits
const NUMERIC_POS: u16 = 0x0000;
const NUMERIC_NEG: u16 = 0x4000;
const NUMERIC_NAN: u16 = 0xC000;
const NUMERIC_PINF: u16 = 0xD000;
const NUMERIC_NINF: u16 = 0xF000;

/// Decode the PG NUMERIC binary protocol into a decimal string.
///
/// Wire format (all big-endian):
/// - `i16` ndigits (number of base-10000 digits stored)
/// - `i16` weight (NBASE position of the first stored digit)
/// - `u16` sign (one of the `NUMERIC_*` constants above)
/// - `u16` dscale (number of decimal digits to display after the point)
/// - `[i16; ndigits]` base-10000 digits, most significant first
fn format_pg_numeric_binary(raw: &[u8]) -> Result<String, String> {
    if raw.len() < 8 {
        return Err(format!(            "numeric: header truncated ({} bytes, expected >= 8)",
            raw.len()
));
    }
    let ndigits = i16::from_be_bytes([raw[0], raw[1]]);
    let weight = i16::from_be_bytes([raw[2], raw[3]]);
    let sign = u16::from_be_bytes([raw[4], raw[5]]);
    let dscale = u16::from_be_bytes([raw[6], raw[7]]);

    match sign {
        NUMERIC_NAN => return Ok("NaN".to_string()),
        NUMERIC_PINF => return Ok("Infinity".to_string()),
        NUMERIC_NINF => return Ok("-Infinity".to_string()),
        NUMERIC_POS | NUMERIC_NEG => {}
        other => return Err(format!("numeric: unrecognized sign 0x{other:04X}")),
    }

    let ndigits_usize =
        usize::try_from(ndigits).map_err(|_| format!("numeric: negative ndigits ({ndigits})"))?;
    let body = &raw[8..];
    let expected = ndigits_usize * 2;
    if body.len() != expected {
        return Err(format!(            "numeric: body length {} ≠ expected {expected}",
            body.len()
));
    }

    let mut digits = Vec::with_capacity(ndigits_usize);
    for i in 0..ndigits_usize {
        let d = i16::from_be_bytes([body[i * 2], body[i * 2 + 1]]);
        if !(0..10_000).contains(&d) {
            return Err(format!("numeric: out-of-range base-10000 digit {d}"));
        }
        digits.push(u32::try_from(d).expect("non-negative bounded above by 10000"));
    }

    // `digits[i]` represents the value at NBASE-position `weight - i`, so the
    // integer part walks positions `weight..=0` from the front of the array,
    // and the fractional part walks negative positions onward.
    let mut s = String::new();
    if sign == NUMERIC_NEG {
        s.push('-');
    }

    if weight < 0 {
        s.push('0');
    } else {
        let weight_i32 = i32::from(weight);
        for pos in (0..=weight_i32).rev() {
            let idx = weight_i32 - pos;
            let d = usize::try_from(idx)
                .ok()
                .and_then(|i| digits.get(i).copied())
                .unwrap_or(0);
            if pos == weight_i32 {
                // First digit: no leading zeros.
                let _ = write!(s, "{d}");
            } else {
                let _ = write!(s, "{d:04}");
            }
        }
    }

    let dscale_u = u32::from(dscale);
    if dscale_u > 0 {
        s.push('.');
        let mut frac = String::new();
        // Each NBASE position contributes NBASE_DIGITS decimal digits; round
        // up so we cover all fractional digits requested by `dscale`.
        let frac_positions = dscale_u.div_ceil(NBASE_DIGITS);
        for n in 1..=frac_positions {
            let idx = i32::from(weight) + i32::try_from(n).expect("loop bound fits in i32");
            let d = usize::try_from(idx)
                .ok()
                .and_then(|i| digits.get(i).copied())
                .unwrap_or(0);
            let _ = write!(frac, "{d:04}");
        }
        let dscale_len = dscale_u as usize;
        if frac.len() > dscale_len {
            frac.truncate(dscale_len);
        }
        while frac.len() < dscale_len {
            frac.push('0');
        }
        s.push_str(&frac);
    }

    // Strip the sign on a true zero so we don't render "-0".
    if s == "-0" || s.starts_with("-0.") && s.bytes().skip(2).all(|b| b == b'.' || b == b'0') {
        s.remove(0);
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::{format_pg_numeric_binary, is_numeric_type};

    #[test]
    fn is_numeric_covers_int_float_and_numeric_families() {
        for t in ["int2", "int4", "int8", "float4", "float8", "numeric"] {
            assert!(is_numeric_type(t), "{t} should be numeric");
        }
    }

    #[test]
    fn is_numeric_excludes_text_uuid_json_etc() {
        for t in [
            "text",
            "varchar",
            "uuid",
            "jsonb",
            "json",
            "timestamp",
            "timestamptz",
            "date",
            "bool",
            "name",
            "char",
            "bpchar",
            "",
        ] {
            assert!(!is_numeric_type(t), "{t} should NOT be numeric");
        }
    }

    /// Encode a NUMERIC binary payload from a list of base-10000 digits.
    fn encode(ndigits: i16, weight: i16, sign: u16, dscale: u16, digits: &[i16]) -> Vec<u8> {
        let mut v = Vec::with_capacity(8 + digits.len() * 2);
        v.extend_from_slice(&ndigits.to_be_bytes());
        v.extend_from_slice(&weight.to_be_bytes());
        v.extend_from_slice(&sign.to_be_bytes());
        v.extend_from_slice(&dscale.to_be_bytes());
        for d in digits {
            v.extend_from_slice(&d.to_be_bytes());
        }
        v
    }

    #[test]
    fn parses_simple_integer_part_with_fraction() {
        // 12345.6789 → digits [1, 2345, 6789], weight=1, dscale=4
        let raw = encode(3, 1, 0x0000, 4, &[1, 2345, 6789]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "12345.6789");
    }

    #[test]
    fn parses_money_style_value() {
        // 100.50 (numeric(5,2)) → digits [100, 5000], weight=0, dscale=2
        let raw = encode(2, 0, 0x0000, 2, &[100, 5000]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "100.50");
    }

    #[test]
    fn parses_pure_fractional() {
        // 0.001 → digits [10], weight=-1, dscale=3
        let raw = encode(1, -1, 0x0000, 3, &[10]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "0.001");
    }

    #[test]
    fn parses_small_fractional_with_extra_position_padding() {
        // 0.000001 → digits [100], weight=-2, dscale=6
        let raw = encode(1, -2, 0x0000, 6, &[100]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "0.000001");
    }

    #[test]
    fn parses_negative_value() {
        // -42.5 → digits [42, 5000], weight=0, sign=NEG, dscale=1
        let raw = encode(2, 0, 0x4000, 1, &[42, 5000]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "-42.5");
    }

    #[test]
    fn parses_zero_with_scale() {
        // 0.00 (numeric(3,2)) → ndigits=0, weight=-1, dscale=2
        let raw = encode(0, -1, 0x0000, 2, &[]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "0.00");
    }

    #[test]
    fn parses_zero_no_fraction() {
        let raw = encode(0, 0, 0x0000, 0, &[]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "0");
    }

    #[test]
    fn parses_nan_and_infinities() {
        let nan = encode(0, 0, 0xC000, 0, &[]);
        assert_eq!(format_pg_numeric_binary(&nan).unwrap(), "NaN");
        let pinf = encode(0, 0, 0xD000, 0, &[]);
        assert_eq!(format_pg_numeric_binary(&pinf).unwrap(), "Infinity");
        let ninf = encode(0, 0, 0xF000, 0, &[]);
        assert_eq!(format_pg_numeric_binary(&ninf).unwrap(), "-Infinity");
    }

    #[test]
    fn parses_large_integer_with_many_groups() {
        // 1_000_000_000 → digits [10, 0, 0], weight=2, dscale=0
        let raw = encode(3, 2, 0x0000, 0, &[10, 0, 0]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "1000000000");
    }

    #[test]
    fn rejects_truncated_header() {
        let err = format_pg_numeric_binary(&[0, 0, 0, 0]).unwrap_err();
        assert!(err.contains("header truncated"), "{err}");
    }

    #[test]
    fn rejects_body_length_mismatch() {
        // ndigits says 2, body provides only 1 digit (2 bytes).
        let mut raw = encode(2, 0, 0x0000, 0, &[]);
        raw.extend_from_slice(&100i16.to_be_bytes());
        let err = format_pg_numeric_binary(&raw).unwrap_err();
        assert!(err.contains("body length"), "{err}");
    }

    #[test]
    fn negative_zero_normalized_to_zero() {
        // -0.00 → sign=NEG, no digits, dscale=2 — must not render "-0.00"
        let raw = encode(0, -1, 0x4000, 2, &[]);
        assert_eq!(format_pg_numeric_binary(&raw).unwrap(), "0.00");
    }

    // `cell_to_string` end-to-end coverage (including NUMERIC) lives in the
    // `connection_integration` test against a real Postgres testcontainer —
    // the `tokio_postgres::Row` type can't be constructed in pure-rust tests.
}
