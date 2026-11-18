import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
export function BrandLogo({ className = "" }: { className?: string }) {
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: () => api("/branding"),
    staleTime: 60000,
  });
  return (
    <img
      className={`store-logo ${className}`}
      src={query.data?.data.logoUrl ?? "/brand/az-logo.jpg"}
      alt="A&Z Girls Fashion"
    />
  );
}
