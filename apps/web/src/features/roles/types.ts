export type Role = {
  id: string;
  name: string;
  protected: boolean;
  permissions: { roleId: string; permissionKey: string }[];
};

