import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { SmartSelect } from "./SmartSelect";
export function EntitySelect({
  kind,
  name,
  label,
  id,
  initial = "",
  value,
  onChange,
  required = true,
  params = "",
  defaultFirst = false,
}: {
  kind: string;
  name: string;
  label: string;
  id?: string;
  initial?: string;
  value?: string;
  onChange?: (id: string) => void;
  required?: boolean;
  params?: string;
  defaultFirst?: boolean;
}) {
  const [chosen, setChosen] = useState(initial);
  const first = useQuery({
    queryKey: ["default-option", kind, params],
    queryFn: () =>
      api(`/options/${kind}?offset=0${params ? `&${params}` : ""}`),
    enabled: defaultFirst && !chosen && !value,
  });
  useEffect(() => {
    if (defaultFirst && !chosen && !value && first.data?.data?.[0]) {
      setChosen(first.data.data[0].id);
      onChange?.(first.data.data[0].id);
    }
  }, [defaultFirst, chosen, value, first.data, onChange]);
  return (
    <SmartSelect
      id={id}
      name={name}
      label={label}
      required={required}
      placeholder="ابحث بالاسم"
      value={value ?? chosen}
      endpoint={`/options/${kind}${params ? `?${params}` : ""}`}
      optionLabel={(row) => row.name}
      onChange={(row) => {
        setChosen(row.id);
        onChange?.(row.id);
      }}
    />
  );
}
