#!/usr/bin/env python3
"""
Mubu — 幕布风格的大纲与思维导图桌面应用
"""

import sys, json, uuid, os, math
from typing import Optional
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QSplitter, QTreeWidget, QTreeWidgetItem, QGraphicsView,
    QGraphicsScene, QGraphicsObject, QGraphicsPathItem, QGraphicsTextItem,
    QToolBar, QStatusBar, QMenuBar, QMenu, QFileDialog, QMessageBox,
    QColorDialog, QComboBox, QSpinBox, QLabel, QPushButton,
    QAbstractItemView, QAction, QStackedWidget, QSizePolicy, QFrame,
)
from PyQt5.QtCore import (
    Qt, QRectF, QPointF, QTimer, pyqtSignal, QSize,
)
from PyQt5.QtGui import (
    QPainter, QPen, QBrush, QColor, QFont, QFontMetrics,
    QKeySequence, QPainterPath, QPixmap, QFontInfo, QPolygonF,
)
from PyQt5.QtGui import (
    QPainter, QPen, QBrush, QColor, QFont, QFontMetrics,
    QKeySequence, QPainterPath, QPixmap, QFontInfo,
)

# ── Constants ──────────────────────────────────────────────────────────

DEFAULT_FONT_SIZE = 14
DEFAULT_FONT_COLOR = "#2c3e50"
DEFAULT_NODE_COLOR = "#ffffff"
H_SPACING = 80
V_SPACING = 24
NODE_PAD_X = 20
NODE_PAD_Y = 12
CORNER_RADIUS = 8
LINE_COLOR = "#b0bec5"
MAX_NODE_WIDTH = 280
LAYOUTS = ["向右树图", "向下树图", "径向辐射", "左右交错"]

STYLESHEET = """
QMainWindow { background: #f5f5f5; }
QToolBar {
    background: #ffffff;
    border-bottom: 1px solid #e0e0e0;
    padding: 4px 8px;
    spacing: 6px;
}
QToolBar QLabel {
    color: #666;
    font-size: 12px;
}
QToolBar QPushButton {
    background: transparent;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 4px 10px;
    color: #333;
    font-size: 12px;
}
QToolBar QPushButton:hover {
    background: #f0f0f0;
    border-color: #bbb;
}
QToolBar QPushButton:pressed {
    background: #e0e0e0;
}
QComboBox {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 3px 8px;
    color: #333;
    background: #fff;
    min-width: 80px;
}
QComboBox:hover { border-color: #90caf9; }
QSpinBox {
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 3px 6px;
    color: #333;
    background: #fff;
}
QSpinBox:hover { border-color: #90caf9; }
QTreeWidget {
    background: #ffffff;
    border: none;
    font-size: 14px;
    outline: none;
}
QTreeWidget::item {
    padding: 6px 4px;
    border-bottom: 1px solid transparent;
}
QTreeWidget::item:selected {
    background: #e3f2fd;
    color: #1565c0;
}
QTreeWidget::item:hover {
    background: #f5f5f5;
}
QStatusBar {
    background: #fff;
    border-top: 1px solid #e0e0e0;
    color: #999;
    font-size: 11px;
}
QMenuBar {
    background: #fff;
    border-bottom: 1px solid #e0e0e0;
    padding: 2px;
}
QMenuBar::item {
    padding: 4px 12px;
    border-radius: 4px;
}
QMenuBar::item:selected { background: #e3f2fd; }
QMenu {
    background: #fff;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 4px;
}
QMenu::item {
    padding: 6px 24px;
    border-radius: 4px;
}
QMenu::item:selected { background: #e3f2fd; color: #1565c0; }
QMenu::separator {
    height: 1px;
    background: #e0e0e0;
    margin: 4px 8px;
}
"""


# ── Data Model ──────────────────────────────────────────────────────────

class MubuNode:
    def __init__(self, text="新节点", parent=None):
        self.id = uuid.uuid4().hex[:8]
        self.text = text
        self.children = []
        self.parent = parent
        self.expanded = True
        self.font_size = DEFAULT_FONT_SIZE
        self.font_color = DEFAULT_FONT_COLOR
        self.node_color = DEFAULT_NODE_COLOR
        self.side = 0  # 0=auto, 1=prefer left, 2=prefer right (for left-right layout)

    def add_child(self, text="新节点"):
        child = MubuNode(text, parent=self)
        child.font_size = self.font_size
        child.font_color = self.font_color
        child.node_color = self.node_color
        self.children.append(child)
        return child

    def insert_child(self, index, text="新节点"):
        child = MubuNode(text, parent=self)
        self.children.insert(index, child)
        return child

    def insert_sibling(self, text="新节点"):
        if self.parent is None:
            return None
        idx = self.parent.children.index(self)
        return self.parent.insert_child(idx + 1, text)

    def remove(self):
        if self.parent:
            self.parent.children.remove(self)
            self.parent = None

    def detach(self):
        if self.parent:
            self.parent.children.remove(self)
            self.parent = None

    def to_dict(self):
        return {
            "id": self.id, "text": self.text,
            "expanded": self.expanded,
            "font_size": self.font_size,
            "font_color": self.font_color,
            "node_color": self.node_color,
            "side": self.side,
            "children": [c.to_dict() for c in self.children],
        }

    @staticmethod
    def from_dict(d, parent=None):
        node = MubuNode(d.get("text", ""), parent=parent)
        node.id = d.get("id", uuid.uuid4().hex[:8])
        node.expanded = d.get("expanded", True)
        node.font_size = d.get("font_size", DEFAULT_FONT_SIZE)
        node.font_color = d.get("font_color", DEFAULT_FONT_COLOR)
        node.node_color = d.get("node_color", DEFAULT_NODE_COLOR)
        node.side = d.get("side", 0)
        for cd in d.get("children", []):
            node.children.append(MubuNode.from_dict(cd, parent=node))
        return node

    def all_nodes(self):
        result = [self]
        for c in self.children:
            result.extend(c.all_nodes())
        return result


def count_nodes(node):
    return 1 + sum(count_nodes(c) for c in node.children)


# ── Layout Algorithms ──────────────────────────────────────────────────

def node_size(node, fm):
    if node.font_size != DEFAULT_FONT_SIZE:
        f = QFont()
        f.setPointSize(node.font_size)
        fm = QFontMetrics(f)
    text = node.text
    if not text:
        return (2 * NODE_PAD_X, fm.height() + 2 * NODE_PAD_Y)
    if '\n' in text:
        lines = text.split('\n')
        max_w = max(fm.width(l) for l in lines)
        tw = max_w + 2 * NODE_PAD_X
        th = len(lines) * fm.height() + 2 * NODE_PAD_Y
    else:
        tw = fm.width(text) + 2 * NODE_PAD_X
        th = fm.height() + 2 * NODE_PAD_Y
    return (tw, th)


def _subtree_height(node, fm):
    if not node.children or not node.expanded:
        _, h = node_size(node, fm)
        return h
    total = sum(_subtree_height(c, fm) for c in node.children)
    total += V_SPACING * (len(node.children) - 1) if node.children else 0
    _, root_h = node_size(node, fm)
    return max(root_h, total)


def _subtree_width(node, fm):
    if not node.children or not node.expanded:
        w, _ = node_size(node, fm)
        return w
    max_child = max((_subtree_width(c, fm) for c in node.children), default=0.0)
    w, _ = node_size(node, fm)
    return w + max_child + H_SPACING


def _layout_right_tree(node, fm, x, y, result):
    w, h = node_size(node, fm)
    result[node.id] = (x, y, w, h)
    if not node.children or not node.expanded:
        return y + h
    heights = [_subtree_height(c, fm) for c in node.children]
    total_h = sum(heights) + V_SPACING * (len(heights) - 1)
    cy = y + (h - total_h) / 2
    for i, c in enumerate(node.children):
        _layout_right_tree(c, fm, x + w + H_SPACING, cy, result)
        cy += heights[i] + V_SPACING
    return max(y + h, cy - V_SPACING) if heights else y + h


def layout_right_tree(node, fm, x0=0.0, y0=0.0):
    r = {}
    _layout_right_tree(node, fm, x0, y0, r)
    return r


def _layout_down_tree(node, fm, x, y, result):
    w, h = node_size(node, fm)
    result[node.id] = (x, y, w, h)
    if not node.children or not node.expanded:
        return x + w
    widths = [_subtree_width(c, fm) for c in node.children]
    total_w = sum(widths) + H_SPACING * (len(widths) - 1)
    cx = x + (w - total_w) / 2
    for i, c in enumerate(node.children):
        _layout_down_tree(c, fm, cx, y + h + V_SPACING, result)
        cx += widths[i] + H_SPACING
    return max(x + w, cx - H_SPACING) if widths else x + w


def layout_down_tree(node, fm, x0=0.0, y0=0.0):
    r = {}
    _layout_down_tree(node, fm, x0, y0, r)
    return r


def layout_radial(node, fm):
    r = {}
    _layout_radial(node, fm, 0, 0, 0, 2 * math.pi, r, 0)
    return r


def _layout_radial(node, fm, cx, cy, angle_start, angle_end, result, level):
    w, h = node_size(node, fm)
    result[node.id] = (cx - w / 2, cy - h / 2, w, h)
    if not node.children or not node.expanded:
        return
    n = len(node.children)
    if n == 0:
        return
    angle_range = min(angle_end - angle_start, 2 * math.pi * 0.7)
    if n == 1:
        angle_range = 0.6
    max_cw = max(node_size(c, fm)[0] for c in node.children) if n else 0
    if n > 1:
        angle_per = angle_range / (n - 1)
        need_r = (max_cw + 20) / (2 * math.sin(angle_per / 2)) if angle_per > 0.01 else max_cw * n / math.pi
    else:
        need_r = max_cw
    radius = max(80 + level * 60, need_r + 20)
    start = angle_start + (angle_end - angle_start - angle_range) / 2
    for i, c in enumerate(node.children):
        a = start + angle_range * i / (n - 1) if n > 1 else start + angle_range / 2
        nx = cx + radius * math.cos(a)
        ny = cy + radius * math.sin(a)
        _layout_radial(c, fm, nx, ny, a - 0.4, a + 0.4, result, level + 1)


def _layout_left_right(node, fm, x, y, right_side, result):
    w, h = node_size(node, fm)
    result[node.id] = (x, y, w, h)
    if not node.children or not node.expanded:
        return y + h
    heights = [_subtree_height(c, fm) for c in node.children]
    total_h = sum(heights) + V_SPACING * (len(heights) - 1)
    cy = y + (h - total_h) / 2
    for i, c in enumerate(node.children):
        if c.side == 1:
            child_side = False
            crs = True
        elif c.side == 2:
            child_side = True
            crs = False
        else:
            child_side = not right_side
            crs = not right_side
        _layout_left_right(c, fm,
                           x + w + H_SPACING if child_side else x - w - H_SPACING,
                           cy, crs, result)
        cy += heights[i] + V_SPACING
    return max(y + h, cy - V_SPACING) if heights else y + h


def layout_left_right(node, fm):
    r = {}
    _layout_left_right(node, fm, 0, 0, True, r)
    return r


def compute_layout(node, fm, layout_name):
    if layout_name == "向右树图":
        return layout_right_tree(node, fm)
    elif layout_name == "向下树图":
        return layout_down_tree(node, fm)
    elif layout_name == "径向辐射":
        return layout_radial(node, fm)
    elif layout_name == "左右交错":
        return layout_left_right(node, fm)
    return layout_right_tree(node, fm)


# ── View Toggle ─────────────────────────────────────────────────────────

class ViewToggle(QWidget):
    switched = pyqtSignal(int)

    def __init__(self):
        super().__init__()
        self.setFixedHeight(36)
        self._active = 0
        self._tabs = []

    def set_tabs(self, labels):
        self._tabs = labels
        self.setMinimumWidth(len(labels) * 90)

    def set_active(self, index):
        self._active = index
        self.update()

    def paintEvent(self, event):
        if not self._tabs:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w = self.width()
        h = self.height()
        tw = min(w / len(self._tabs), 120)
        total_w = tw * len(self._tabs)
        ox = (w - total_w) / 2

        p.setPen(Qt.NoPen)
        p.setBrush(QColor("#e0e0e0"))
        path = QPainterPath()
        path.addRoundedRect(ox, 4, total_w, h - 8, 14, 14)
        p.drawPath(path)

        for i, label in enumerate(self._tabs):
            x = ox + i * tw
            if i == self._active:
                p.setBrush(QColor("#1976d2"))
                path2 = QPainterPath()
                path2.addRoundedRect(x + 2, 5, tw - 4, h - 10, 12, 12)
                p.drawPath(path2)
                p.setPen(Qt.white)
            else:
                p.setPen(QColor("#666"))
            f = QFont()
            f.setPointSize(11)
            p.setFont(f)
            p.drawText(QRectF(x, 0, tw, h), Qt.AlignCenter, label)

    def mousePressEvent(self, event):
        if not self._tabs:
            return
        w = self.width()
        tw = min(w / len(self._tabs), 120)
        total_w = tw * len(self._tabs)
        ox = (w - total_w) / 2
        for i in range(len(self._tabs)):
            x = ox + i * tw
            if x <= event.x() < x + tw:
                if i != self._active:
                    self._active = i
                    self.update()
                    self.switched.emit(i)
                break


# ── Outline View ────────────────────────────────────────────────────────

class OutlineItemDelegate:
    pass


class OutlineWidget(QTreeWidget):
    node_edited = pyqtSignal(str, str)
    structure_changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.setHeaderHidden(True)
        self.setAnimated(True)
        self.setIndentation(28)
        self.setExpandsOnDoubleClick(False)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setDefaultDropAction(Qt.MoveAction)
        self.setDragEnabled(True)
        self.setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self.setVerticalScrollMode(QAbstractItemView.ScrollPerPixel)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.itemChanged.connect(self._on_item_changed)
        self.itemExpanded.connect(self._on_expanded)
        self.itemCollapsed.connect(self._on_collapsed)
        self._root_node = None
        self._updating = False
        self._node_map = {}

    def set_root(self, node):
        self._root_node = node
        self._rebuild()

    def _rebuild(self):
        self._updating = True
        self.clear()
        self._node_map.clear()
        if self._root_node:
            self._build_tree(self._root_node, None)
            self.expandAll()
        self._updating = False

    def _build_tree(self, node, parent_item):
        item = QTreeWidgetItem()
        item.setText(0, node.text)
        item.setData(0, Qt.UserRole, node.id)
        item.setFlags(item.flags() | Qt.ItemIsEditable)
        f = QFont()
        f.setPointSize(node.font_size)
        item.setFont(0, f)
        item.setForeground(0, QBrush(QColor(node.font_color)))
        bg = QColor(node.node_color)
        if bg != QColor("#ffffff"):
            item.setBackground(0, QBrush(bg))
        if parent_item:
            parent_item.addChild(item)
        else:
            self.addTopLevelItem(item)
        self._node_map[node.id] = item
        if node.expanded:
            for child in node.children:
                self._build_tree(child, item)

    def _on_item_changed(self, item, column):
        if self._updating:
            return
        nid = item.data(0, Qt.UserRole)
        if nid:
            self.node_edited.emit(nid, item.text(0))

    def _on_expanded(self, item):
        if self._updating:
            return
        n = self._find_node(item.data(0, Qt.UserRole))
        if n:
            n.expanded = True

    def _on_collapsed(self, item):
        if self._updating:
            return
        n = self._find_node(item.data(0, Qt.UserRole))
        if n:
            n.expanded = False

    def _find_node(self, nid):
        if self._root_node is None:
            return None
        for n in self._root_node.all_nodes():
            if n.id == nid:
                return n
        return None

    def get_selected_node(self):
        items = self.selectedItems()
        if not items:
            return None
        return self._find_node(items[0].data(0, Qt.UserRole))

    def add_child(self):
        sel = self.get_selected_node()
        if sel is None:
            return
        sel.add_child("新节点")
        self._rebuild()
        self.structure_changed.emit()

    def add_sibling(self):
        sel = self.get_selected_node()
        if sel is None or sel.parent is None:
            return
        sibling = sel.insert_sibling("新节点")
        if sibling:
            self._rebuild()
            self.structure_changed.emit()

    def delete_selected(self):
        sel = self.get_selected_node()
        if sel is None or sel.parent is None:
            return
        sel.remove()
        self._rebuild()
        self.structure_changed.emit()

    def indent(self):
        sel = self.get_selected_node()
        if sel is None or sel.parent is None:
            return
        siblings = sel.parent.children
        idx = siblings.index(sel)
        if idx > 0:
            new_parent = siblings[idx - 1]
            sel.detach()
            new_parent.children.append(sel)
            sel.parent = new_parent
            self._rebuild()
            self.structure_changed.emit()

    def outdent(self):
        sel = self.get_selected_node()
        if sel is None or sel.parent is None or sel.parent.parent is None:
            return
        grandparent = sel.parent.parent
        sel.detach()
        idx = grandparent.children.index(sel.parent) + 1
        grandparent.children.insert(idx, sel)
        sel.parent = grandparent
        self._rebuild()
        self.structure_changed.emit()

    def apply_font_size(self, size):
        sel = self.get_selected_node()
        if sel is None:
            return
        sel.font_size = size
        self._rebuild()
        self.structure_changed.emit()

    def apply_font_color(self, color):
        sel = self.get_selected_node()
        if sel is None:
            return
        sel.font_color = color
        self._rebuild()
        self.structure_changed.emit()

    def apply_node_color(self, color):
        sel = self.get_selected_node()
        if sel is None:
            return
        sel.node_color = color
        self._rebuild()
        self.structure_changed.emit()

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Tab:
            self.indent()
        elif event.key() == Qt.Key_Backtab:
            self.outdent()
        elif event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self.add_sibling()
        elif event.key() == Qt.Key_Insert:
            self.add_child()
        elif event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            sel = self.get_selected_node()
            if sel and sel.parent:
                self.delete_selected()
            else:
                super().keyPressEvent(event)
        else:
            super().keyPressEvent(event)

    def contextMenuEvent(self, event):
        from PyQt5.QtWidgets import QMenu
        node = self.get_selected_node()
        menu = QMenu()
        menu.addAction("添加子节点", self.add_child)
        menu.addAction("添加同级节点", self.add_sibling)
        menu.addSeparator()
        left_act = menu.addAction("← 左侧展开 (左右交错布局)")
        right_act = menu.addAction("→ 右侧展开 (左右交错布局)")
        auto_act = menu.addAction("↔ 自动交替")
        menu.addSeparator()
        menu.addAction("删除节点", self.delete_selected)
        action = menu.exec_(self.viewport().mapToGlobal(event.pos()))
        if node:
            if action == left_act:
                node.side = 1
            elif action == right_act:
                node.side = 2
            elif action == auto_act:
                node.side = 0
            else:
                return
            self._rebuild()
            self.structure_changed.emit()


# ── Mind Map Graphics Items ────────────────────────────────────────────

class NodeItem(QGraphicsObject):
    text_changed = pyqtSignal(str, str)
    collapse_toggled = pyqtSignal()

    def __init__(self, node, x, y, w, h):
        super().__init__()
        self.node = node
        self.rect_w = w
        self.rect_h = h
        self.setPos(x, y)
        self.setFlags(self.flags() | QGraphicsObject.ItemIsSelectable)
        self.setAcceptHoverEvents(True)
        self._hovered = False
        self._editing = False
        self._text_item = None
        self._collapse_rect = QRectF()

    def boundingRect(self):
        return QRectF(0, 0, self.rect_w, self.rect_h)

    def paint(self, painter, option, widget=None):
        rect = self.boundingRect()
        painter.setRenderHint(QPainter.Antialiasing)

        shadow = QRectF(rect.x() + 2, rect.y() + 2, rect.width(), rect.height())
        painter.setBrush(QColor(0, 0, 0, 20))
        painter.setPen(Qt.NoPen)
        path_s = QPainterPath()
        path_s.addRoundedRect(shadow, CORNER_RADIUS, CORNER_RADIUS)
        painter.drawPath(path_s)

        color = QColor(self.node.node_color)
        if self.isSelected():
            painter.setPen(QPen(QColor("#1976d2"), 2.5))
        elif self._hovered:
            painter.setPen(QPen(QColor("#90caf9"), 2))
        else:
            painter.setPen(QPen(QColor("#e0e0e0"), 1))
        painter.setBrush(QBrush(color))
        path = QPainterPath()
        path.addRoundedRect(rect, CORNER_RADIUS, CORNER_RADIUS)
        painter.drawPath(path)

        if not self._editing:
            painter.setPen(QColor(self.node.font_color))
            f = QFont()
            f.setPointSize(self.node.font_size)
            painter.setFont(f)
            text_rect = rect.adjusted(NODE_PAD_X, NODE_PAD_Y,
                                       -NODE_PAD_X, -NODE_PAD_Y)
            painter.drawText(text_rect,
                             Qt.AlignLeft | Qt.AlignTop,
                             self.node.text)

        # Collapse indicator
        self._collapse_rect = QRectF()
        if self.node.children:
            size = 10
            cx = rect.width() - size - 4
            cy = (rect.height() - size) / 2
            self._collapse_rect = QRectF(cx, cy, size, size)
            painter.setPen(QPen(QColor("#78909c"), 1.5))
            painter.setBrush(QBrush(Qt.NoBrush))
            painter.drawRect(self._collapse_rect)
            if self.node.expanded:
                pts = [QPointF(cx + 2, cy + 3),
                       QPointF(cx + size - 2, cy + 3),
                       QPointF(cx + size / 2, cy + size - 3)]
            else:
                pts = [QPointF(cx + 3, cy + 2),
                       QPointF(cx + 3, cy + size - 2),
                       QPointF(cx + size - 3, cy + size / 2)]
            painter.setBrush(QBrush(QColor("#78909c")))
            painter.setPen(Qt.NoPen)
            painter.drawPolygon(QPolygonF(pts))

    def update_size(self, w, h):
        self.prepareGeometryChange()
        self.rect_w = w
        self.rect_h = h
        self.update()

    def start_edit(self):
        if self._editing:
            return
        self._editing = True
        self._text_item = QGraphicsTextItem(self.node.text, self)
        f = QFont()
        f.setPointSize(self.node.font_size)
        self._text_item.setFont(f)
        self._text_item.setDefaultTextColor(QColor(self.node.font_color))
        self._text_item.setTextInteractionFlags(Qt.TextEditorInteraction)
        self._text_item.setPos(NODE_PAD_X, NODE_PAD_Y)
        self._text_item.setFocus()
        self._text_item.document().contentsChanged.connect(
            self._on_text_changed)

    def _on_text_changed(self):
        if self._text_item:
            doc = self._text_item.document()
            doc.setTextWidth(-1)
            nw = doc.idealWidth() + 2 * NODE_PAD_X + 4
            nh = doc.size().height() + 2 * NODE_PAD_Y + 4
            self.update_size(max(nw, 40), max(nh, 30))
            self.node.text = self._text_item.toPlainText()
            self.text_changed.emit(self.node.id, self.node.text)

    def finish_edit(self):
        if not self._editing:
            return
        self._editing = False
        if self._text_item:
            self.node.text = self._text_item.toPlainText()
            self.scene().removeItem(self._text_item)
            self._text_item = None
        self.update()

    def is_editing(self):
        return self._editing

    def hoverEnterEvent(self, event):
        self._hovered = True
        self.update()

    def hoverLeaveEvent(self, event):
        self._hovered = False
        self.update()

    def mousePressEvent(self, event):
        if not self._collapse_rect.isNull() and self._collapse_rect.contains(event.pos()):
            self.node.expanded = not self.node.expanded
            self.collapse_toggled.emit()
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseDoubleClickEvent(self, event):
        self.start_edit()
        super().mouseDoubleClickEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape and self._editing:
            self.finish_edit()
        super().keyPressEvent(event)

    def itemChange(self, change, value):
        if change == QGraphicsObject.ItemSelectedHasChanged:
            if not value and self._editing:
                self.finish_edit()
        return super().itemChange(change, value)


class ConnectionItem(QGraphicsPathItem):
    def __init__(self, parent_item, child_item, layout_name):
        super().__init__()
        self.parent_item = parent_item
        self.child_item = child_item
        self.layout_name = layout_name
        self.setPen(QPen(QColor(LINE_COLOR), 1.5))
        self.setBrush(QBrush(Qt.NoBrush))
        self.setZValue(-1)
        self._update_path()

    def _update_path(self):
        pr = self.parent_item.boundingRect()
        cr = self.child_item.boundingRect()
        pp = self.parent_item.pos()
        cp = self.child_item.pos()

        if self.layout_name == "向下树图":
            x1, y1 = pp.x() + pr.width() / 2, pp.y() + pr.height()
            x2, y2 = cp.x() + cr.width() / 2, cp.y()
            cy = abs(y2 - y1) * 0.5
            cx1, cy1 = x1, y1 + cy
            cx2, cy2 = x2, y2 - cy
        elif self.layout_name == "径向辐射":
            x1 = pp.x() + pr.width() / 2
            y1 = pp.y() + pr.height() / 2
            x2 = cp.x() + cr.width() / 2
            y2 = cp.y() + cr.height() / 2
            dx, dy = x2 - x1, y2 - y1
            cx1 = x1 + dx * 0.4
            cy1 = y1 + dy * 0.1
            cx2 = x2 - dx * 0.4
            cy2 = y2 - dy * 0.1
        elif self.layout_name == "左右交错":
            if cp.x() > pp.x():
                x1, y1 = pp.x() + pr.width(), pp.y() + pr.height() / 2
                x2, y2 = cp.x(), cp.y() + cr.height() / 2
                cx1 = x1 + abs(x2 - x1) * 0.5
                cy1 = y1
                cx2 = x2 - abs(x2 - x1) * 0.5
                cy2 = y2
            else:
                x1, y1 = pp.x(), pp.y() + pr.height() / 2
                x2, y2 = cp.x() + cr.width(), cp.y() + cr.height() / 2
                cx1 = x1 - abs(x2 - x1) * 0.5
                cy1 = y1
                cx2 = x2 + abs(x2 - x1) * 0.5
                cy2 = y2
        else:
            x1, y1 = pp.x() + pr.width(), pp.y() + pr.height() / 2
            x2, y2 = cp.x(), cp.y() + cr.height() / 2
            cx1 = x1 + abs(x2 - x1) * 0.5
            cy1 = y1
            cx2 = x2 - abs(x2 - x1) * 0.5
            cy2 = y2

        path = QPainterPath()
        path.moveTo(x1, y1)
        path.cubicTo(cx1, cy1, cx2, cy2, x2, y2)
        self.setPath(path)

    def update_path(self):
        self._update_path()


# ── Mind Map View ──────────────────────────────────────────────────────

class MindmapView(QGraphicsView):
    node_text_changed = pyqtSignal(str, str)
    node_structure_changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.setScene(QGraphicsScene(self))
        self.setRenderHint(QPainter.Antialiasing)
        self.setRenderHint(QPainter.SmoothPixmapTransform)
        self.setViewportUpdateMode(QGraphicsView.FullViewportUpdate)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorUnderMouse)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.setBackgroundBrush(QBrush(QColor("#fafafa")))
        self.setFrameShape(QFrame.NoFrame)
        self._zoom_level = 1.0
        self._min_zoom = 0.1
        self._max_zoom = 5.0
        self._layout_name = "向右树图"
        self._root_node = None
        self._node_items = {}
        self._rebuild_timer = QTimer()
        self._rebuild_timer.setSingleShot(True)
        self._rebuild_timer.setInterval(200)
        self._rebuild_timer.timeout.connect(self._rebuild_scene)

    def set_root(self, node):
        self._root_node = node
        self.rebuild()

    def set_layout(self, name):
        self._layout_name = name
        self.rebuild()

    def get_layout(self):
        return self._layout_name

    def rebuild(self):
        self._rebuild_timer.start()

    def _rebuild_scene(self):
        scene = self.scene()

        # Save selection before clear
        selected_ids = set()
        for item in scene.selectedItems():
            if isinstance(item, NodeItem):
                selected_ids.add(item.node.id)

        scene.clear()
        self._node_items.clear()

        if self._root_node is None:
            return

        try:
            fm = QFontMetrics(QFont())
            layout = compute_layout(self._root_node, fm, self._layout_name)
            items = []
            for n in self._root_node.all_nodes():
                if n.id in layout:
                    x, y, w, h = layout[n.id]
                    items.append((n, x, y, w, h))

            if not items:
                return

            min_x = min(x for _, x, _, _, _ in items) if items else 0
            min_y = min(y for _, _, y, _, _ in items) if items else 0
            ox, oy = 50 - min(min_x, 0), 50 - min(min_y, 0)

            node_map = {}
            for n, x, y, w, h in items:
                item = NodeItem(n, x + ox, y + oy, w, h)
                item.text_changed.connect(self._on_text_changed)
                item.collapse_toggled.connect(self.rebuild)
                scene.addItem(item)
                node_map[n.id] = item
                self._node_items[n.id] = item

            for n in self._root_node.all_nodes():
                if n.id in node_map and n.parent and n.parent.id in node_map:
                    conn = ConnectionItem(
                        node_map[n.parent.id], node_map[n.id], self._layout_name)
                    scene.addItem(conn)

            # Restore selection
            for item in scene.items():
                if isinstance(item, NodeItem) and item.node.id in selected_ids:
                    item.setSelected(True)

            QTimer.singleShot(50, self._center_content)
        except Exception:
            pass

    def _center_content(self):
        try:
            if self._root_node is None:
                return
            rect = self.scene().itemsBoundingRect()
            if rect is None or rect.isEmpty() or not rect.isValid():
                return
            margin = 40
            self.setSceneRect(rect.adjusted(-margin, -margin, margin, margin))
            self.fitInView(rect.adjusted(-margin/2, -margin/2,
                                          margin/2, margin/2),
                           Qt.KeepAspectRatio)
        except Exception:
            pass

    def _on_text_changed(self, node_id, text):
        self.node_text_changed.emit(node_id, text)

    def wheelEvent(self, event):
        if event.modifiers() & Qt.ControlModifier:
            delta = event.angleDelta().y()
            factor = 1.1 if delta > 0 else 0.9
            new_zoom = self._zoom_level * factor
            if self._min_zoom <= new_zoom <= self._max_zoom:
                self._zoom_level = new_zoom
                self.scale(factor, factor)
        else:
            super().wheelEvent(event)

    def _editing_active(self):
        for item in self.scene().items():
            if isinstance(item, NodeItem) and item.is_editing():
                return True
        return False

    def _selected_node_item(self):
        for item in self.scene().selectedItems():
            if isinstance(item, NodeItem):
                return item
        return None

    def _add_child_mm(self):
        item = self._selected_node_item()
        if item is None or self._root_node is None:
            return
        child = item.node.add_child("新节点")
        self.rebuild()
        self.node_structure_changed.emit()

    def _add_sibling_mm(self):
        item = self._selected_node_item()
        if item is None or item.node.parent is None:
            return
        item.node.insert_sibling("新节点")
        self.rebuild()
        self.node_structure_changed.emit()

    def _delete_node_mm(self):
        item = self._selected_node_item()
        if item is None or item.node.parent is None:
            return
        item.node.remove()
        self.rebuild()
        self.node_structure_changed.emit()

    def _on_mm_context_menu(self, pos):
        from PyQt5.QtWidgets import QMenu
        item = self.itemAt(pos)
        if item is not None and isinstance(item, NodeItem):
            item.setSelected(True)
        menu = QMenu()
        act_add_child = menu.addAction("添加子节点")
        act_add_sibling = menu.addAction("添加同级节点")
        menu.addSeparator()
        act_collapse = menu.addAction("折叠子节点")
        act_expand = menu.addAction("展开子节点")
        menu.addSeparator()
        act_set_left = menu.addAction("← 设此节点为左侧展开")
        act_set_right = menu.addAction("→ 设此节点为右侧展开")
        act_set_auto = menu.addAction("↔ 自动交替")
        menu.addSeparator()
        act_delete = menu.addAction("删除节点")
        action = menu.exec_(self.viewport().mapToGlobal(pos))
        if action == act_add_child:
            self._add_child_mm()
        elif action == act_add_sibling:
            self._add_sibling_mm()
        elif action == act_collapse:
            item = self._selected_node_item()
            if item:
                item.node.expanded = False
                self.rebuild()
                self.node_structure_changed.emit()
        elif action == act_expand:
            item = self._selected_node_item()
            if item:
                item.node.expanded = True
                self.rebuild()
                self.node_structure_changed.emit()
        elif action == act_set_left:
            item = self._selected_node_item()
            if item:
                item.node.side = 1
                self.rebuild()
                self.node_structure_changed.emit()
        elif action == act_set_right:
            item = self._selected_node_item()
            if item:
                item.node.side = 2
                self.rebuild()
                self.node_structure_changed.emit()
        elif action == act_set_auto:
            item = self._selected_node_item()
            if item:
                item.node.side = 0
                self.rebuild()
                self.node_structure_changed.emit()
        elif action == act_delete:
            self._delete_node_mm()

    def contextMenuEvent(self, event):
        self._on_mm_context_menu(event.pos())

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            if self._editing_active():
                super().keyPressEvent(event)
                return
            else:
                self._add_sibling_mm()
                return
        elif event.key() == Qt.Key_F2:
            item = self._selected_node_item()
            if item:
                item.start_edit()
                return
        elif event.key() == Qt.Key_Insert:
            self._add_child_mm()
            return
        elif event.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            if self._editing_active():
                super().keyPressEvent(event)
            else:
                self._delete_node_mm()
            return
        super().keyPressEvent(event)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._center_content()


# ── Import / Export ────────────────────────────────────────────────────

def export_json(node):
    return json.dumps(node.to_dict(), ensure_ascii=False, indent=2)


def import_json(text):
    return MubuNode.from_dict(json.loads(text))


def export_markdown(node, level=0):
    prefix = "  " * level + "- " if level > 0 else ""
    result = prefix + node.text + "\n"
    for c in node.children:
        result += export_markdown(c, level + 1)
    return result


def import_markdown(text):
    lines = text.strip().split("\n")
    root = MubuNode("根节点")
    stack = [(root, -1)]
    for line in lines:
        stripped = line.lstrip()
        if not stripped:
            continue
        indent = len(line) - len(stripped)
        is_bullet = stripped.startswith("- ") or stripped.startswith("* ")
        if is_bullet:
            stripped = stripped[2:]
        while stack and stack[-1][1] >= indent:
            stack.pop()
        if stack:
            parent = stack[-1][0]
            child = parent.add_child(stripped.strip())
            child.expanded = True
            stack.append((child, indent))
    return root


def export_opml(node):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<opml version="2.0">',
        "  <head>",
        '    <title>{}</title>'.format(node.text),
        "  </head>",
        "  <body>",
    ]
    lines.extend(_opml_body(node, 4))
    lines.append("  </body>")
    lines.append("</opml>")
    return "\n".join(lines)


def _opml_body(node, indent):
    lines = []
    pad = " " * indent
    attrs = 'text="{}"'.format(node.text)
    if node.children:
        lines.append("{pad}<outline {attrs}>".format(pad=pad, attrs=attrs))
        for c in node.children:
            lines.extend(_opml_body(c, indent + 2))
        lines.append("{pad}</outline>".format(pad=pad))
    else:
        lines.append("{pad}<outline {attrs}/>".format(pad=pad, attrs=attrs))
    return lines


def import_opml(text):
    import xml.etree.ElementTree as ET
    root_el = ET.fromstring(text)
    body = root_el.find("body")
    if body is None:
        return MubuNode("根节点")
    outlines = body.findall("outline")
    if not outlines:
        return MubuNode("根节点")

    def parse(el, parent):
        text = el.get("text", el.get("title", ""))
        if parent.text == "根节点" and not parent.children:
            parent.text = text
            node = parent
        else:
            node = parent.add_child(text)
        for child in el:
            parse(child, node)

    root = MubuNode("根节点")
    for o in outlines:
        parse(o, root)
    if root.children:
        return root.children[0]
    return root


# ── Main Window ────────────────────────────────────────────────────────

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Mubu - 幕布风格大纲与思维导图")
        self.setGeometry(100, 100, 1200, 800)
        self.setMinimumSize(800, 600)
        self.setStyleSheet(STYLESHEET)

        self._root = self._create_sample_doc()
        self._current_file = None
        self._modified = False
        self._current_view = 0  # 0=outline, 1=mindmap
        self._build_ui()
        self._connect_signals()
        self._update_title()
        self._sync_outline_to_mindmap()

    def _create_sample_doc(self):
        r = MubuNode("中心主题")
        b1 = r.add_child("什么是幕布")
        b1.add_child("幕布是一款大纲笔记工具")
        b1.add_child("支持一键转换为思维导图")
        b1.add_child("适合读书笔记、会议记录、学习总结")
        b2 = r.add_child("核心功能")
        b2.add_child("大纲编辑：Tab缩进、Enter换行")
        b2.add_child("思维导图：多种布局、自由缩放")
        b2.add_child("格式定制：字号、颜色、背景")
        b2.add_child("导入导出：JSON/Markdown/OPML")
        b3 = r.add_child("快捷键指南")
        b3.add_child("Insert：添加子节点")
        b3.add_child("Enter：添加同级节点")
        b3.add_child("Tab / Shift+Tab：缩进 / 减少缩进")
        b3.add_child("Delete：删除节点")
        b3.add_child("Ctrl+1 / Ctrl+2：切换大纲 / 导图")
        return r

    def _build_ui(self):
        self._setup_menu()
        self._setup_toolbar()
        self._setup_central()
        self._setup_statusbar()

    def _setup_menu(self):
        mb = self.menuBar()
        fm = mb.addMenu("文件(&F)")
        self._act_new = QAction("新建(&N)", self)
        self._act_new.setShortcut(QKeySequence.New)
        self._act_new.triggered.connect(self._new_doc)
        fm.addAction(self._act_new)
        self._act_open = QAction("打开(&O)...", self)
        self._act_open.setShortcut(QKeySequence.Open)
        self._act_open.triggered.connect(self._open_file)
        fm.addAction(self._act_open)
        self._act_save = QAction("保存(&S)", self)
        self._act_save.setShortcut(QKeySequence.Save)
        self._act_save.triggered.connect(self._save_file)
        fm.addAction(self._act_save)
        self._act_save_as = QAction("另存为...", self)
        self._act_save_as.setShortcut(QKeySequence.SaveAs)
        self._act_save_as.triggered.connect(self._save_as_file)
        fm.addAction(self._act_save_as)
        fm.addSeparator()
        imp = fm.addMenu("导入")
        imp.addAction("导入 JSON...", lambda: self._import_file("json"))
        imp.addAction("导入 Markdown...", lambda: self._import_file("md"))
        imp.addAction("导入 OPML...", lambda: self._import_file("opml"))
        exp = fm.addMenu("导出")
        exp.addAction("导出 JSON...", lambda: self._export_file("json"))
        exp.addAction("导出 Markdown...", lambda: self._export_file("md"))
        exp.addAction("导出 OPML...", lambda: self._export_file("opml"))
        exp.addSeparator()
        exp.addAction("导出为图片...", self._export_image)
        fm.addSeparator()
        fm.addAction("退出(&Q)", self.close, QKeySequence.Quit)

        em = mb.addMenu("编辑(&E)")
        self._act_add_child = QAction("添加子节点", self)
        self._act_add_child.setShortcut(QKeySequence(Qt.Key_Insert))
        self._act_add_child.triggered.connect(self._add_child)
        em.addAction(self._act_add_child)
        self._act_add_sibling = QAction("添加同级节点", self)
        self._act_add_sibling.setShortcut(QKeySequence(Qt.Key_Return))
        self._act_add_sibling.triggered.connect(self._add_sibling)
        em.addAction(self._act_add_sibling)
        em.addSeparator()
        self._act_delete = QAction("删除节点", self)
        self._act_delete.setShortcut(QKeySequence(Qt.Key_Delete))
        self._act_delete.triggered.connect(self._delete_node)
        em.addAction(self._act_delete)
        em.addSeparator()
        self._act_indent = QAction("增加缩进", self)
        self._act_indent.setShortcut(QKeySequence(Qt.Key_Tab))
        self._act_indent.triggered.connect(self._indent)
        em.addAction(self._act_indent)
        self._act_outdent = QAction("减少缩进", self)
        self._act_outdent.setShortcut(
            QKeySequence(Qt.SHIFT | Qt.Key_Backtab))
        self._act_outdent.triggered.connect(self._outdent)
        em.addAction(self._act_outdent)

        vm = mb.addMenu("视图(&V)")
        self._act_focus_outline = QAction("切换到大纲视图", self)
        self._act_focus_outline.setShortcut(QKeySequence("Ctrl+1"))
        self._act_focus_outline.triggered.connect(
            lambda: self._switch_view(0))
        vm.addAction(self._act_focus_outline)
        self._act_focus_mindmap = QAction("切换到思维导图", self)
        self._act_focus_mindmap.setShortcut(QKeySequence("Ctrl+2"))
        self._act_focus_mindmap.triggered.connect(
            lambda: self._switch_view(1))
        vm.addAction(self._act_focus_mindmap)

        hm = mb.addMenu("帮助(&H)")
        hm.addAction("关于 Mubu", self._show_about)

    def _setup_toolbar(self):
        tb = QToolBar("工具栏", self)
        tb.setMovable(False)
        tb.setIconSize(QSize(16, 16))
        self.addToolBar(tb)

        tb.addWidget(QLabel("布局"))
        self._layout_combo = QComboBox()
        self._layout_combo.addItems(LAYOUTS)
        self._layout_combo.currentTextChanged.connect(self._on_layout_change)
        tb.addWidget(self._layout_combo)
        tb.addSeparator()

        tb.addWidget(QLabel("字号"))
        self._font_size_spin = QSpinBox()
        self._font_size_spin.setRange(1, 72)
        self._font_size_spin.setValue(DEFAULT_FONT_SIZE)
        self._font_size_spin.valueChanged.connect(self._on_font_size_change)
        tb.addWidget(self._font_size_spin)
        tb.addSeparator()

        self._btn_font_color = QPushButton("A")
        self._btn_font_color.setToolTip("文字颜色")
        self._btn_font_color.clicked.connect(self._on_font_color)
        tb.addWidget(self._btn_font_color)

        self._btn_node_color = QPushButton("■")
        self._btn_node_color.setToolTip("节点背景色")
        self._btn_node_color.clicked.connect(self._on_node_color)
        tb.addWidget(self._btn_node_color)

        tb.addSeparator()
        self._btn_zoomin = QPushButton("＋")
        self._btn_zoomin.setToolTip("放大")
        self._btn_zoomin.clicked.connect(self.zoom_in)
        tb.addWidget(self._btn_zoomin)

        self._btn_zoomout = QPushButton("－")
        self._btn_zoomout.setToolTip("缩小")
        self._btn_zoomout.clicked.connect(self.zoom_out)
        tb.addWidget(self._btn_zoomout)

        self._btn_fit = QPushButton("适应")
        self._btn_fit.clicked.connect(self.fit_view)
        tb.addWidget(self._btn_fit)

    def _setup_central(self):
        central = QWidget()
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self._view_toggle = ViewToggle()
        self._view_toggle.set_tabs(["📝 大纲视图", "🧠 思维导图"])
        self._view_toggle.switched.connect(self._switch_view)
        layout.addWidget(self._view_toggle, 0, Qt.AlignCenter)

        spacer = QWidget()
        spacer.setFixedHeight(8)
        layout.addWidget(spacer)

        self._stack = QStackedWidget()
        self._outline = OutlineWidget()
        self._outline.set_root(self._root)
        self._mindmap = MindmapView()
        self._mindmap.set_root(self._root)
        self._stack.addWidget(self._outline)
        self._stack.addWidget(self._mindmap)
        self._stack.setCurrentIndex(0)
        layout.addWidget(self._stack, 1)

        self.setCentralWidget(central)

    def _setup_statusbar(self):
        self._status = QStatusBar()
        self.setStatusBar(self._status)
        self._update_status()

    def _connect_signals(self):
        self._outline.node_edited.connect(self._on_outline_text_edit)
        self._outline.structure_changed.connect(self._on_structure_change)
        self._mindmap.node_text_changed.connect(self._on_mindmap_text_edit)
        self._mindmap.node_structure_changed.connect(self._on_structure_change)

    def _switch_view(self, index):
        self._current_view = index
        self._view_toggle.set_active(index)
        self._stack.setCurrentIndex(index)
        if index == 0:
            self._outline.setFocus()
        else:
            self._mindmap.setFocus()
            self._sync_outline_to_mindmap()
        self._update_status()

    def _on_outline_text_edit(self, node_id, new_text):
        n = self._find_node(node_id)
        if n:
            n.text = new_text
            self._modified = True
            self._update_title()
            self._update_status()

    def _on_mindmap_text_edit(self, node_id, new_text):
        n = self._find_node(node_id)
        if n:
            n.text = new_text
            self._modified = True
            self._sync_mindmap_to_outline()
            self._update_title()
            self._update_status()

    def _on_structure_change(self):
        self._modified = True
        self._outline.set_root(self._root)
        self._sync_outline_to_mindmap()
        self._update_title()
        self._update_status()

    def _on_layout_change(self, layout):
        self._mindmap.set_layout(layout)

    def _get_active_node(self):
        if self._current_view == 1:
            item = self._mindmap._selected_node_item()
            if item:
                return item.node
        return self._outline.get_selected_node() or self._root

    def _on_font_size_change(self, size):
        node = self._get_active_node()
        node.font_size = size
        self._outline.set_root(self._root)
        self._sync_outline_to_mindmap()

    def _on_font_color(self):
        node = self._get_active_node()
        color = QColorDialog.getColor(QColor(node.font_color), self,
                                       "选择文字颜色")
        if color.isValid():
            node.font_color = color.name()
            self._outline.set_root(self._root)
            self._sync_outline_to_mindmap()

    def _on_node_color(self):
        node = self._get_active_node()
        color = QColorDialog.getColor(QColor(node.node_color), self,
                                       "选择节点背景色")
        if color.isValid():
            node.node_color = color.name()
            self._outline.set_root(self._root)
            self._sync_outline_to_mindmap()

    def _find_node(self, nid):
        if self._root is None:
            return None
        for n in self._root.all_nodes():
            if n.id == nid:
                return n
        return None

    def _sync_outline_to_mindmap(self):
        self._mindmap.set_root(self._root)

    def _sync_mindmap_to_outline(self):
        self._outline.set_root(self._root)

    def _update_title(self):
        title = "Mubu - 幕布风格大纲与思维导图"
        if self._current_file:
            title = "{} - {}".format(os.path.basename(self._current_file), title)
        if self._modified:
            title = "* " + title
        self.setWindowTitle(title)

    def _update_status(self):
        n = count_nodes(self._root)
        view_name = ["大纲", "思维导图"][self._current_view]
        fname = os.path.basename(self._current_file) if self._current_file else "新建文档"
        modified = " ● 已修改" if self._modified else ""
        self._status.showMessage("{}  |  节点数: {}  |  {}{}".format(
            fname, n, view_name, modified))

    def _show_about(self):
        QMessageBox.about(self, "关于 Mubu",
            "<h3>Mubu v1.0</h3>"
            "<p>幕布风格的大纲与思维导图桌面应用</p>"
            "<p>基于 PyQt5 开发，支持大纲编辑、思维导图、"
            "格式定制、导入导出等功能。</p>")

    def _add_child(self):
        self._outline.add_child()

    def _add_sibling(self):
        self._outline.add_sibling()

    def _delete_node(self):
        self._outline.delete_selected()

    def _indent(self):
        self._outline.indent()

    def _outdent(self):
        self._outline.outdent()

    def zoom_in(self):
        self._mindmap._zoom_level *= 1.2
        self._mindmap.scale(1.2, 1.2)

    def zoom_out(self):
        self._mindmap._zoom_level *= 0.833
        self._mindmap.scale(0.833, 0.833)

    def fit_view(self):
        self._mindmap._center_content()

    def _new_doc(self):
        if self._modified:
            ret = QMessageBox.question(
                self, "未保存", "当前文档已修改，是否保存?",
                QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
            if ret == QMessageBox.Cancel:
                return
            if ret == QMessageBox.Yes:
                self._save_file()
        self._root = MubuNode("中心主题")
        self._current_file = None
        self._modified = False
        self._outline.set_root(self._root)
        self._sync_outline_to_mindmap()
        self._switch_view(0)
        self._update_title()
        self._update_status()

    def _open_file(self):
        if self._modified:
            ret = QMessageBox.question(
                self, "未保存", "当前文档已修改，是否保存?",
                QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
            if ret == QMessageBox.Cancel:
                return
            if ret == QMessageBox.Yes:
                self._save_file()
        path, _ = QFileDialog.getOpenFileName(
            self, "打开文件", "",
            "Mubu Files (*.mubu *.json);;All Files (*)")
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
            self._root = import_json(data)
            self._current_file = path
            self._modified = False
            self._outline.set_root(self._root)
            self._sync_outline_to_mindmap()
            self._switch_view(0)
            self._update_title()
            self._update_status()
        except Exception as e:
            QMessageBox.critical(self, "错误", "打开文件失败: {}".format(e))

    def _save_file(self):
        if self._current_file:
            try:
                with open(self._current_file, "w", encoding="utf-8") as f:
                    f.write(export_json(self._root))
                self._modified = False
                self._update_title()
                self._update_status()
            except Exception as e:
                QMessageBox.critical(self, "错误", "保存失败: {}".format(e))
        else:
            self._save_as_file()

    def _save_as_file(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "另存为", "", "Mubu Files (*.mubu *.json);;All Files (*)")
        if not path:
            return
        self._current_file = path
        self._save_file()

    def _import_file(self, fmt):
        filters = {
            "json": "JSON (*.json)",
            "md": "Markdown (*.md *.markdown)",
            "opml": "OPML (*.opml *.xml)",
        }
        path, _ = QFileDialog.getOpenFileName(
            self, "导入 {} 文件".format(fmt.upper()), "",
            filters.get(fmt, "All Files (*)"))
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
            if fmt == "json":
                self._root = import_json(data)
            elif fmt == "md":
                self._root = import_markdown(data)
            elif fmt == "opml":
                self._root = import_opml(data)
            self._modified = True
            self._outline.set_root(self._root)
            self._sync_outline_to_mindmap()
            self._switch_view(0)
            self._update_title()
            self._update_status()
            QMessageBox.information(self, "导入成功",
                                    "已从 {} 导入".format(fmt.upper()))
        except Exception as e:
            QMessageBox.critical(self, "导入失败",
                                 "导入 {} 失败: {}".format(fmt.upper(), e))

    def _export_file(self, fmt):
        ext_map = {
            "json": ("JSON (*.json)", ".json"),
            "md": ("Markdown (*.md)", ".md"),
            "opml": ("OPML (*.opml)", ".opml"),
        }
        desc, ext = ext_map.get(fmt, ("All Files (*)", ""))
        path, _ = QFileDialog.getSaveFileName(
            self, "导出为 {}".format(fmt.upper()),
            "untitled{}".format(ext), desc)
        if not path:
            return
        try:
            funcs = {"json": export_json, "md": export_markdown,
                     "opml": export_opml}
            with open(path, "w", encoding="utf-8") as f:
                f.write(funcs[fmt](self._root))
            QMessageBox.information(self, "导出成功",
                                    "已导出为 {} 格式".format(fmt.upper()))
        except Exception as e:
            QMessageBox.critical(self, "导出失败",
                                 "导出失败: {}".format(e))

    def _export_image(self):
        if self._current_view != 1:
            self._switch_view(1)
            QApplication.processEvents()
        scene = self._mindmap.scene()
        if not scene:
            return
        rect = scene.itemsBoundingRect().adjusted(-20, -20, 20, 20)
        if rect is None or rect.isEmpty() or not rect.isValid():
            QMessageBox.warning(self, "提示", "思维导图为空，无法导出")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "导出为图片", "mindmap.png",
            "PNG (*.png);;JPEG (*.jpg *.jpeg)")
        if not path:
            return
        try:
            pixmap = QPixmap(int(rect.width()), int(rect.height()))
            pixmap.fill(QColor("#fafafa"))
            painter = QPainter(pixmap)
            painter.setRenderHint(QPainter.Antialiasing)
            scene.render(painter, QRectF(), rect)
            painter.end()
            pixmap.save(path)
            QMessageBox.information(self, "导出成功", "思维导图已导出为图片")
        except Exception as e:
            QMessageBox.critical(self, "导出失败",
                                 "导出图片失败: {}".format(e))

    def closeEvent(self, event):
        if self._modified:
            ret = QMessageBox.question(
                self, "未保存", "当前文档已修改，是否保存?",
                QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel)
            if ret == QMessageBox.Cancel:
                event.ignore()
                return
            if ret == QMessageBox.Yes:
                self._save_file()
        event.accept()


# ── Entry Point ────────────────────────────────────────────────────────

def main():
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)
    app = QApplication(sys.argv)
    app.setApplicationName("Mubu")
    f = QFont("Microsoft YaHei", 10)
    f.setStyleStrategy(QFont.PreferAntialias)
    app.setFont(f)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
