import { isNotNull } from "../utils";

export type ColumnType = [title: string, width: number, align: "l" | "r"];

export class ColumnPrinter {
    constructor(
        public columns: ColumnType[],
        public separator: string = "  "
    ) {
        for (const ct of this.columns) {
            const [title, width, _] = ct;
            ct[1] = width > 0 ? Math.max(width, title.length) : 0;
        }
    }

    line(...items: string[]) {
        function alignText(width: number, align: string, item: unknown) {
            if (width === 0) return null;
            const text = String(item);
            return align === "l" ? text.padEnd(width) : text.padStart(width);
        }
        const chunks = this.columns.map(([_, width, align], ind) => alignText(width, align, items[ind])).filter(isNotNull);
        return chunks.join(this.separator);

    }

    printHeader() {
        this.printLine(...this.columns.map((it) => it[0]));
    }

    printLine(...items: string[]) {
        console.log(this.line(...items));
    }
}
