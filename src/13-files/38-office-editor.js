// Office 编辑只暴露可独立写回的文字与单元格，不将抽出的 Markdown 当原件。
/** @typedef {{part:string,label:string,value:string,related:string[],set:(value:string)=>void}} OfficeField */
function officeEditorModel(parts, extension) {
  /** @type {Map<string, Document>} */
  const docs = new Map(Object.entries(parts).map(([name, xml]) => [name, parseXml(String(xml))]));
  /** @type {OfficeField[]} */
  const fields = [];
  let chars = 0;
  const add = (part, label, value, set, related = []) => {
    if (/[\u0000-\u001f]/.test(value)) return;
    chars += value.length;
    if (fields.length >= 2000 || chars > 200000) throw Error(t("可编辑项目过多，请使用本机程序"));
    fields.push({ part, label, value, set, related });
  };
  const simpleText = node => node && !node.children.length && !/[\u0000-\u001f]/.test(node.textContent);
  const replaceText = (node, value) => {
    node.textContent = value;
    node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  };
  const inside = (node, names) => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement)
      if (names.includes(parent.localName)) return true;
    return false;
  };
  const number = value => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
  const requireNumber = value => {
    if (!number(value)) throw Error(t("数字单元格只能输入有效数字"));
    return value;
  };
  if (extension === "docx") {
    const part = "word/document.xml",
      doc = docs.get(part);
    if (!doc) throw Error(t("此文档没有可安全编辑的内容"));
    const ns = doc.documentElement.namespaceURI;
    let fieldDepth = 0;
    for (const [i, paragraph] of xmlDeep(doc, "p").entries()) {
      if (paragraph.namespaceURI !== ns || inside(paragraph, ["p", "ins", "del", "sdt", "fldSimple", "moveFrom", "moveTo"])) continue;
      const markers = xmlDeep(paragraph, "fldChar");
      if (markers.length || fieldDepth || xmlDeep(paragraph, "instrText").length) {
        for (const marker of markers) {
          const kind = marker.getAttributeNS(ns, "fldCharType");
          if (kind === "begin") fieldDepth++;
          else if (kind === "end") fieldDepth = Math.max(0, fieldDepth - 1);
        }
        continue;
      }
      const runs = xmlKids(paragraph, "r").filter(
        run =>
          run.namespaceURI === ns &&
          [...run.children].every(child => child.namespaceURI === ns && ["rPr", "t"].includes(child.localName))
      );
      for (const [j, run] of runs.entries()) {
        const nodes = xmlKids(run, "t");
        if (nodes.length !== 1 || !simpleText(nodes[0])) continue;
        const node = nodes[0];
        add(part, t("段落") + " " + (i + 1) + " · " + (j + 1), node.textContent, value => replaceText(node, value));
      }
    }
  } else if (extension === "xlsx") {
    const sharedPart = "xl/sharedStrings.xml",
      bookPart = "xl/workbook.xml",
      shared = docs.get(sharedPart),
      strings = shared ? xmlDeep(shared, "si") : [],
      workbook = docs.get(bookPart),
      rels = docs.get("xl/_rels/workbook.xml.rels"),
      targets = new Map(
        rels
          ? xmlDeep(rels, "Relationship")
              .filter(rel => rel.getAttribute("TargetMode") !== "External")
              .map(rel => [rel.getAttribute("Id"), "xl/" + String(rel.getAttribute("Target")).replace(/^\/?xl\//, "")])
          : []
      ),
      names = new Map(
        workbook ? xmlDeep(workbook, "sheet").map(sheet => [targets.get(sheet.getAttribute("r:id")), sheet.getAttribute("name")]) : []
      ),
      related = workbook ? [bookPart] : [];
    const recalc = () => {
      if (!workbook) return;
      const root = workbook.documentElement;
      let calc = xmlKids(root, "calcPr")[0];
      if (!calc) {
        calc = workbook.createElementNS(root.namespaceURI, root.prefix ? root.prefix + ":calcPr" : "calcPr");
        calc.setAttribute("calcId", "0");
        const next = [...root.children].find(child =>
          [
            "oleSize",
            "customWorkbookViews",
            "pivotCaches",
            "smartTagPr",
            "smartTagTypes",
            "webPublishing",
            "fileRecoveryPr",
            "webPublishObjects",
            "extLst"
          ].includes(child.localName)
        );
        root.insertBefore(calc, next || null);
      }
      calc.setAttribute("fullCalcOnLoad", "1");
    };
    for (const [part, doc] of docs) {
      if (!/^xl\/worksheets\/[^/]+\.xml$/.test(part)) continue;
      const ns = doc.documentElement.namespaceURI;
      // 数组/数据表公式的覆盖范围可能含无 f 的缓存格；整张表留给原程序，避免把缓存格当数据格。
      if (xmlDeep(doc, "f").some(f => ["array", "dataTable"].includes(f.getAttribute("t")))) continue;
      if (xmlDeep(doc, "sheetProtection").length) continue;
      for (const cell of xmlDeep(doc, "c")) {
        const ref = cell.getAttribute("r"),
          kind = cell.getAttribute("t") || "n",
          v = xmlKids(cell, "v")[0];
        if (
          cell.namespaceURI !== ns || cell.parentElement?.localName !== "row" || !ref || !/^[A-Z]+[1-9]\d*$/.test(ref) ||
          xmlKids(cell, "f").length || xmlKids(cell, "extLst").length || cell.hasAttribute("cm") || cell.hasAttribute("vm")
        ) continue;
        const label = (names.get(part) || part.split("/").pop()) + " · " + ref;
        if (kind === "n" && v && simpleText(v) && number(v.textContent)) {
          add(part, label, v.textContent, value => {
            v.textContent = requireNumber(value);
            recalc();
          }, related);
        } else if (kind === "s" && v && /^\d+$/.test(v.textContent)) {
          const item = strings[Number(v.textContent)],
            node = item && xmlKids(item, "t")[0];
          if (!item || item.children.length !== 1 || !simpleText(node)) continue;
          add(part, label, node.textContent, value => {
            const inline = doc.createElementNS(ns, cell.prefix ? cell.prefix + ":is" : "is"),
              text = doc.createElementNS(ns, cell.prefix ? cell.prefix + ":t" : "t");
            replaceText(text, value);
            inline.appendChild(text);
            cell.replaceChild(inline, v);
            cell.setAttribute("t", "inlineStr");
            // 两个计数都是可选的；转换为独立字符串后移除旧计数，不改任何其他单元格的共享索引。
            shared.documentElement.removeAttribute("count");
            shared.documentElement.removeAttribute("uniqueCount");
            recalc();
          }, [...related, sharedPart]);
        } else if (kind === "inlineStr") {
          const item = xmlKids(cell, "is")[0],
            node = item && xmlKids(item, "t")[0];
          if (item?.children.length === 1 && simpleText(node))
            add(part, label, node.textContent, value => {
              replaceText(node, value);
              recalc();
            }, related);
        }
      }
    }
  } else {
    const part = "content.xml",
      doc = docs.get(part);
    if (!doc) throw Error(t("此文档没有可安全编辑的内容"));
    const textNS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
      tableNS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
      officeNS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
    const body = doc.getElementsByTagNameNS(officeNS, "body")[0];
    if (!body) throw Error(t("此文档没有可安全编辑的内容"));
    if (extension === "odt") {
      const paragraphs = [...body.getElementsByTagNameNS(textNS, "*")].filter(node => ["p", "h"].includes(node.localName));
      for (const [i, node] of paragraphs.entries()) {
        if (simpleText(node) && !inside(node, ["tracked-changes", "annotation", "section"]))
          add(part, t("段落") + " " + (i + 1), node.textContent, value => { node.textContent = value; });
      }
    } else {
      for (const table of body.getElementsByTagNameNS(tableNS, "table")) {
        if (inside(table, ["table"]) || table.getAttributeNS(tableNS, "protected") === "true") continue;
        let r = 0;
        for (const row of table.getElementsByTagNameNS(tableNS, "table-row")) {
          if (inside(row, ["table-cell"])) continue;
          const repeated = Number(row.getAttributeNS(tableNS, "number-rows-repeated") || 1);
          if (!Number.isSafeInteger(repeated) || repeated < 1 || r + repeated > 1048576) break;
          let c = 0;
          for (const cell of [...row.children].filter(node => node.namespaceURI === tableNS &&
            ["table-cell", "covered-table-cell"].includes(node.localName))) {
            const count = Number(cell.getAttributeNS(tableNS, "number-columns-repeated") || 1),
              node = cell.getElementsByTagNameNS(textNS, "p")[0],
              kind = cell.getAttributeNS(officeNS, "value-type");
            if (!Number.isSafeInteger(count) || count < 1 || c + count > 16384) break;
            if (repeated === 1 && count === 1 && cell.localName === "table-cell" && !cell.hasAttributeNS(tableNS, "formula") &&
                !cell.hasAttributeNS(tableNS, "number-columns-spanned") && !cell.hasAttributeNS(tableNS, "number-rows-spanned") &&
                cell.children.length === 1 && simpleText(node)) {
              const label = (table.getAttributeNS(tableNS, "name") || "") + " · " + xlsxRef(c, r);
              if (kind === "string" && !cell.hasAttributeNS(officeNS, "string-value"))
                add(part, label, node.textContent, value => { node.textContent = value; });
              else if (kind === "float" && number(node.textContent) && node.textContent === cell.getAttributeNS(officeNS, "value"))
                add(part, label, node.textContent, value => {
                  node.textContent = requireNumber(value);
                  cell.setAttributeNS(officeNS, "office:value", value);
                });
            }
            c += count;
          }
          r += repeated;
        }
      }
    }
  }
  if (!fields.length) throw Error(t("此文档没有可安全编辑的内容"));
  return { docs, fields };
}
function officeEditorChanges(parts, extension, values) {
  const { docs, fields } = officeEditorModel(parts, extension),
    changed = new Set(),
    output = {};
  if (!Array.isArray(values) || values.length !== fields.length) throw Error(t("此文档没有可安全编辑的内容"));
  let chars = 0;
  for (const [i, field] of fields.entries()) {
    if (typeof values[i] !== "string" || /[\u0000-\u001f]/.test(values[i])) throw Error(t("文档编辑不支持控制字符或换行"));
    chars += values[i].length;
    if (chars > 200000) throw Error(t("可编辑项目过多，请使用本机程序"));
    for (const part of [field.part, ...field.related]) output[part] = parts[part];
    if (values[i] === field.value) continue;
    field.set(values[i]);
    for (const part of [field.part, ...field.related]) changed.add(part);
  }
  const serializer = new XMLSerializer();
  for (const part of changed) {
    // Document 的 open() 与项目宽松 DOM 声明里的 EventTarget.open 冲突；实际 DOM Document 是合法的 Node。
    const xml = serializer.serializeToString(/** @type {Node} */ (/** @type {unknown} */ (docs.get(part))));
    parseXml(xml);
    output[part] = xml;
  }
  return output;
}
