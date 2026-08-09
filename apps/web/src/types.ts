export type UserRole = "operator" | "viewer";

export type AuthUser = {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
};

export type DashboardSummary = {
  totalProducts: number;
  totalOrders: number;
  revenue: number;
  lowStockItems: number;
};

export type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  reorderLevel: number;
};

export type OrderStatus = "processing" | "shipped" | "delivered";

export type Order = {
  id: number;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  total: number;
  createdAt: string;
};

export type CreateOrderInput = {
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  total: number;
};

export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type PaginatedResponse<T> = {
  items: T[];
  pagination: Pagination;
};
