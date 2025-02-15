import GridMouseHandler from '../GridMouseHandler';
import GridUtils from '../GridUtils';

const DEFAULT_INTERVAL_MS = 100;

class GridSelectionMouseHandler extends GridMouseHandler {
  startPoint = null;

  hasExtendedFloating = false;

  // Timer used when holding a drag past the end of the grid
  timer = null;

  lastTriggerTime = null;

  dragBounds = null;

  onDown(gridPoint, grid, event) {
    const { x, y, column, row } = gridPoint;
    const { metrics } = grid;
    const { gridX, gridY, maxX, maxY } = metrics;
    const gridMouseX = x - gridX;
    const gridMouseY = y - gridY;
    if (
      gridMouseX < 0 ||
      gridMouseY < 0 ||
      (column == null && gridMouseX > maxX) ||
      (row == null && gridMouseY > maxY)
    ) {
      return false;
    }

    const isModifierKey = GridUtils.isModifierKeyDown(event);
    const isShiftKey = event.shiftKey;
    if (!isModifierKey) {
      if (isShiftKey) {
        grid.trimSelectedRanges();
      } else {
        grid.clearSelectedRanges();
      }
    }

    const theme = grid.getTheme();
    const { autoSelectRow, autoSelectColumn } = theme;
    // If they click a column/row header, don't want to select the whole table if auto select column/row is on
    if (
      (column !== null || !autoSelectColumn) &&
      (row !== null || !autoSelectRow)
    ) {
      grid.focus();
      grid.moveCursorToPosition(
        column,
        row,
        isShiftKey,
        true,
        isShiftKey && isModifierKey
      );
    }

    this.startPoint = gridPoint;
    this.hasExtendedFloating = false;
    this.dragBounds = GridUtils.getScrollDragBounds(metrics, row, column);

    return true;
  }

  onDrag(gridPoint, grid) {
    if (this.startPoint === null) {
      return false;
    }

    this.stopTimer();

    const { row: startRow, column: startColumn } = this.startPoint;
    const { x, y } = gridPoint;
    let { row, column } = gridPoint;
    const { metrics } = grid;
    const { left, lastLeft, top, lastTop, columnWidth, rowHeight } = metrics;
    const dragBounds = GridUtils.getScrollDragBounds(
      metrics,
      startRow,
      startColumn
    );

    // If we're dragging outside of the grid entirely, then we should start scrolling
    let deltaX = 0;
    let deltaY = 0;
    if (left < lastLeft) {
      if (x < dragBounds.x) {
        deltaX = x - dragBounds.x;
      } else if (x > dragBounds.x2) {
        deltaX = x - dragBounds.x2;
      }
    }
    if (top < lastTop) {
      if (y < dragBounds.y) {
        deltaY = y - dragBounds.y;
      } else if (y > dragBounds.y2) {
        deltaY = y - dragBounds.y2;
      }
    }

    if (deltaX !== 0 || deltaY !== 0) {
      // Have it go faster depending on how far out they've dragged
      this.startTimer(
        grid,
        gridPoint,
        deltaX > 0
          ? Math.ceil(deltaX / columnWidth)
          : Math.floor(deltaX / columnWidth),
        deltaY > 0
          ? Math.ceil(deltaY / rowHeight)
          : Math.floor(deltaY / rowHeight)
      );
    } else if (row != null && column != null) {
      const {
        floatingTopRowCount,
        floatingBottomRowCount,
        floatingLeftColumnCount,
        floatingRightColumnCount,
        columnCount,
        rowCount,
        bottom,
        right,
        topVisible,
        bottomVisible,
        leftVisible,
        rightVisible,
      } = metrics;
      // When selection crosses from a floating area to a non floating area, we need to scroll instead of jumping to the floating area
      // So when that happens, just adjust the point to be past the new boundary
      if (!this.hasExtendedFloating) {
        if (startRow < floatingTopRowCount && row >= floatingTopRowCount) {
          // Extending from floating top into the view
          row = floatingTopRowCount;
          this.hasExtendedFloating = true;
        } else if (
          startRow >= rowCount - floatingBottomRowCount &&
          row < rowCount - floatingBottomRowCount
        ) {
          // Extending from floating bottom into the view
          row = rowCount - floatingBottomRowCount - 1;
          this.hasExtendedFloating = true;
        }

        if (
          startColumn < floatingLeftColumnCount &&
          column >= floatingLeftColumnCount
        ) {
          // Extending from floating left into the view
          column = floatingLeftColumnCount;
          this.hasExtendedFloating = true;
        } else if (
          startColumn >= columnCount - floatingRightColumnCount &&
          column < columnCount - floatingRightColumnCount
        ) {
          // Extending from floating right into the view
          column = columnCount - floatingRightColumnCount - 1;
          this.hasExtendedFloating = true;
        }
      }

      // When a selection is dragging from within the main area to over a floating area, scroll.
      if (
        !GridUtils.isFloatingRow(startRow, metrics) &&
        GridUtils.isFloatingRow(row, metrics)
      ) {
        // Need to scroll
        if (startRow > row && row < top) {
          row = topVisible - 1;
        } else if (startRow < row && row > bottom) {
          row = bottomVisible + 1;
        }
      }
      if (
        !GridUtils.isFloatingColumn(startColumn, metrics) &&
        GridUtils.isFloatingColumn(column, metrics)
      ) {
        if (startColumn > column && column < left) {
          column = leftVisible - 1;
        } else if (startColumn < column && column > right) {
          column = rightVisible + 1;
        }
      }
      grid.moveCursorToPosition(column, row, true, true);
    }
    return true;
  }

  onUp(gridPoint, grid) {
    if (this.startPoint !== null) {
      this.startPoint = null;
      this.dragBounds = null;
      this.stopTimer();
      grid.commitSelection();
    }

    return false;
  }

  moveSelection(grid, gridPoint, deltaX, deltaY) {
    const { row, column } = gridPoint;
    const { metrics } = grid;
    const { selectionEndRow, selectionEndColumn } = grid.state;
    const { rowCount, columnCount } = metrics;
    const minX = deltaX < 0 && column != null ? column : 0;
    const maxX = deltaX > 0 && column != null ? column : columnCount - 1;
    const minY = deltaY < 0 && row != null ? row : 0;
    const maxY = deltaY > 0 && row != null ? row : rowCount - 1;
    grid.moveCursorToPosition(
      Math.min(Math.max(minX, selectionEndColumn + deltaX), maxX),
      Math.min(Math.max(minY, selectionEndRow + deltaY), maxY),
      true
    );
    this.lastTriggerTime = Date.now();
  }

  startTimer(grid, gridPoint, deltaX, deltaY) {
    this.stopTimer();

    const timeout =
      this.lastTriggerTime != null
        ? DEFAULT_INTERVAL_MS -
          Math.min(DEFAULT_INTERVAL_MS, Date.now() - this.lastTriggerTime)
        : 0;
    this.timer = setTimeout(() => {
      this.moveSelection(grid, gridPoint, deltaX, deltaY);
      this.startTimer(grid, gridPoint, deltaX, deltaY);
    }, timeout);
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

export default GridSelectionMouseHandler;
