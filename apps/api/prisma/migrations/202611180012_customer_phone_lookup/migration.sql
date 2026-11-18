-- Preserve existing display values and financial references; index their canonical phone key.
CREATE FUNCTION customer_phone_key(value TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
 WITH cleaned AS (SELECT regexp_replace(translate(value,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') AS digits),
 normalized AS (SELECT CASE WHEN digits LIKE '00%' THEN substr(digits,3) ELSE digits END AS digits FROM cleaned)
 SELECT CASE WHEN digits ~ '^0[0-9]{9,10}$' THEN '20'||substr(digits,2)
 WHEN digits ~ '^(10|11|12|15)[0-9]{8}$' THEN '20'||digits ELSE digits END FROM normalized;
$$;
CREATE INDEX "Customer_phone_key_idx" ON "Customer" (customer_phone_key("phone") text_pattern_ops);
