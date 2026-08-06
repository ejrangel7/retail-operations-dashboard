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

export type Order = {
  id: number;
  orderNumber: string;
  customerName: string;
  status: "processing" | "shipped" | "delivered";
  total: number;
  createdAt: string;
};

