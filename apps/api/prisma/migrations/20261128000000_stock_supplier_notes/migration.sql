-- CreateTable
CREATE TABLE "stock_supplier_notes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "movement_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_supplier_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_supplier_notes_movement_id_key" ON "stock_supplier_notes"("movement_id");

-- CreateIndex
CREATE INDEX "stock_supplier_notes_organization_id_supplier_id_created_at_idx" ON "stock_supplier_notes"("organization_id", "supplier_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_supplier_notes" ADD CONSTRAINT "stock_supplier_notes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
