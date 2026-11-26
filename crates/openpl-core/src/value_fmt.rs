use oracle::sql_type::{OracleType, Timestamp};
use oracle::ParseOracleTypeError;

pub(crate) fn parse_timestamp(text: &str) -> Result<Timestamp, ParseOracleTypeError> {
    text.trim().parse()
}

pub(crate) fn format_timestamp(value: &Timestamp, data_type: &OracleType) -> String {
    let year = value.year();
    let sign = if year < 0 { "-" } else { "" };
    let mut text = format!(
        "{sign}{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        year.unsigned_abs(),
        value.month(),
        value.day(),
        value.hour(),
        value.minute(),
        value.second()
    );
    if !matches!(data_type, OracleType::Date) && value.nanosecond() > 0 {
        let fraction = format!(".{:09}", value.nanosecond());
        text.push_str(fraction.trim_end_matches('0'));
    }
    if matches!(data_type, OracleType::TimestampTZ(_)) {
        let seconds = value.tz_offset();
        let minutes = seconds.unsigned_abs() / 60;
        let sign = if seconds < 0 { '-' } else { '+' };
        text.push_str(&format!(" {sign}{:02}:{:02}", minutes / 60, minutes % 60));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fecha_y_timestamp_tienen_formato_fijo() {
        let date = parse_timestamp("2026-11-24").unwrap();
        assert_eq!(
            format_timestamp(&date, &OracleType::Date),
            "2026-11-24 00:00:00"
        );
        let stamp = parse_timestamp("2026-11-24T14:20:05.120000 +05:30").unwrap();
        assert_eq!(
            format_timestamp(&stamp, &OracleType::TimestampTZ(9)),
            "2026-11-24 14:20:05.12 +05:30"
        );
        assert_eq!(
            format_timestamp(&stamp, &OracleType::TimestampLTZ(9)),
            "2026-11-24 14:20:05.12"
        );
    }

    #[test]
    fn utc_y_fracciones_se_pueden_leer_de_nuevo() {
        let stamp = parse_timestamp("2026-11-24T14:20:05.000000001Z").unwrap();
        let text = format_timestamp(&stamp, &OracleType::TimestampTZ(9));
        assert_eq!(text, "2026-11-24 14:20:05.000000001 +00:00");
        assert_eq!(parse_timestamp(&text).unwrap(), stamp);
        assert!(parse_timestamp("2026-11-24T14:20:05Z basura").is_err());
    }
}
