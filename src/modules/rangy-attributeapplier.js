/**
 * Attribute Applier module for Rangy.
 * Adds, removes and toggles attributes on Ranges and Selections
 *
 * This is the class appliter module modified to work with attributes instead
 *
 * Part of Rangy, a cross-browser JavaScript range and selection library
 * https://github.com/timdown/rangy
 *
 * Depends on Rangy core.
 *
 * Copyright %%build:year%%, Tim Down
 * Licensed under the MIT license.
 * Version: %%build:version%%
 * Build date: %%build:date%%
 */
/* build:modularizeWithRangyDependency */
rangy.createModule("AttributeApplier", ["WrappedSelection"], function(api, module) {
    var dom = api.dom;
    var DomPosition = dom.DomPosition;
    var contains = dom.arrayContains;
    var util = api.util;
    var forEach = util.forEach;

    var log = log4javascript.getLogger("rangy.attributeapplier");

    var defaultTagName = "span";
    var createElementNSSupported = util.isHostMethod(document, "createElementNS");

    function each(obj, func) {
        for (var i in obj) {
            if (obj.hasOwnProperty(i)) {
                if (func(i, obj[i]) === false) {
                    return false;
                }
            }
        }
        return true;
    }

    function trim(str) {
        return str.replace(/^\s\s*/, "").replace(/\s\s*$/, "");
    }

    function canTextBeStyled(textNode) {
        var parent = textNode.parentNode;
        return (parent && parent.nodeType == 1 && !/^(textarea|style|script|select|iframe)$/i.test(parent.nodeName));
    }

    function movePosition(position, oldParent, oldIndex, newParent, newIndex) {
        var posNode = position.node, posOffset = position.offset;
        var newNode = posNode, newOffset = posOffset;

        if (posNode == newParent && posOffset > newIndex) {
            ++newOffset;
        }

        if (posNode == oldParent && (posOffset == oldIndex  || posOffset == oldIndex + 1)) {
            newNode = newParent;
            newOffset += newIndex - oldIndex;
        }

        if (posNode == oldParent && posOffset > oldIndex + 1) {
            --newOffset;
        }

        position.node = newNode;
        position.offset = newOffset;
    }

    function movePositionWhenRemovingNode(position, parentNode, index) {
        log.debug("movePositionWhenRemovingNode " + position, position.node == parentNode, position.offset, index)
        if (position.node == parentNode && position.offset > index) {
            --position.offset;
        }
    }

    function movePreservingPositions(node, newParent, newIndex, positionsToPreserve) {
        log.group("movePreservingPositions " + dom.inspectNode(node) + " to index " + newIndex + " in " + dom.inspectNode(newParent), positionsToPreserve);
        // For convenience, allow newIndex to be -1 to mean "insert at the end".
        if (newIndex == -1) {
            newIndex = newParent.childNodes.length;
        }

        var oldParent = node.parentNode;
        var oldIndex = dom.getNodeIndex(node);

        forEach(positionsToPreserve, function(position) {
            movePosition(position, oldParent, oldIndex, newParent, newIndex);
        });

        // Now actually move the node.
        if (newParent.childNodes.length == newIndex) {
            newParent.appendChild(node);
        } else {
            newParent.insertBefore(node, newParent.childNodes[newIndex]);
        }
        log.groupEnd();
    }

    function removePreservingPositions(node, positionsToPreserve) {
        log.group("removePreservingPositions " + dom.inspectNode(node), positionsToPreserve);

        var oldParent = node.parentNode;
        var oldIndex = dom.getNodeIndex(node);

        forEach(positionsToPreserve, function(position) {
            movePositionWhenRemovingNode(position, oldParent, oldIndex);
        });

        dom.removeNode(node);
        log.groupEnd();
    }

    function moveChildrenPreservingPositions(node, newParent, newIndex, removeNode, positionsToPreserve) {
        var child, children = [];
        while ( (child = node.firstChild) ) {
            movePreservingPositions(child, newParent, newIndex++, positionsToPreserve);
            children.push(child);
        }
        if (removeNode) {
            removePreservingPositions(node, positionsToPreserve);
        }
        return children;
    }

    function replaceWithOwnChildrenPreservingPositions(element, positionsToPreserve) {
        return moveChildrenPreservingPositions(element, element.parentNode, dom.getNodeIndex(element), true, positionsToPreserve);
    }

    function rangeSelectsAnyText(range, textNode) {
        var textNodeRange = range.cloneRange();
        textNodeRange.selectNodeContents(textNode);

        var intersectionRange = textNodeRange.intersection(range);
        var text = intersectionRange ? intersectionRange.toString() : "";

        return text != "";
    }

    function getEffectiveTextNodes(range) {
        var nodes = range.getNodes([3]);

        // Optimization as per issue 145

        // Remove non-intersecting text nodes from the start of the range
        var start = 0, node;
        while ( (node = nodes[start]) && !rangeSelectsAnyText(range, node) ) {
            ++start;
        }

        // Remove non-intersecting text nodes from the start of the range
        var end = nodes.length - 1;
        while ( (node = nodes[end]) && !rangeSelectsAnyText(range, node) ) {
            --end;
        }

        return nodes.slice(start, end + 1);
    }

    function haveSameAttributeGroup(el1, el2, attributeGroup) {
        var attribute;
        for (var i = 0; i < attributeGroup.length; i++) {
          attribute = attributeGroup[i];
          el1HasAttributeSet = el1.hasAttribute(attribute);
          el2HasAttributeSet = el2.hasAttribute(attribute);
          if (el1HasAttributeSet && el2HasAttributeSet) {
             if (el1.getAttribute(attribute) !== el2.getAttribute(attribute)) {
                return false;
             }
          } else if (el1HasAttributeSet && el1.getAttribute(attribute) !== "false") {
            return false;
          } else if (el2HasAttributeSet && el2.getAttribute(attribute) !== "false") {
            return false;
          }
        }
        return true;
    }

    var getComputedStyleProperty = dom.getComputedStyleProperty;
    var isEditableElement = (function() {
        var testEl = document.createElement("div");
        return typeof testEl.isContentEditable == "boolean" ?
            function (node) {
                return node && node.nodeType == 1 && node.isContentEditable;
            } :
            function (node) {
                if (!node || node.nodeType != 1 || node.contentEditable == "false") {
                    return false;
                }
                return node.contentEditable == "true" || isEditableElement(node.parentNode);
            };
    })();

    function isEditingHost(node) {
        var parent;
        return node && node.nodeType == 1 &&
            (( (parent = node.parentNode) && parent.nodeType == 9 && parent.designMode == "on") ||
            (isEditableElement(node) && !isEditableElement(node.parentNode)));
    }

    function isEditable(node) {
        return (isEditableElement(node) || (node.nodeType != 1 && isEditableElement(node.parentNode))) && !isEditingHost(node);
    }

    var inlineDisplayRegex = /^inline(-block|-table)?$/i;

    function isNonInlineElement(node) {
        return node && node.nodeType == 1 && !inlineDisplayRegex.test(getComputedStyleProperty(node, "display"));
    }

    // White space characters as defined by HTML 4 (http://www.w3.org/TR/html401/struct/text.html)
    var htmlNonWhiteSpaceRegex = /[^\r\n\t\f \u200B]/;

    function isUnrenderedWhiteSpaceNode(node) {
        if (node.data.length == 0) {
            return true;
        }
        if (htmlNonWhiteSpaceRegex.test(node.data)) {
            return false;
        }
        var cssWhiteSpace = getComputedStyleProperty(node.parentNode, "whiteSpace");
        switch (cssWhiteSpace) {
            case "pre":
            case "pre-wrap":
            case "-moz-pre-wrap":
                return false;
            case "pre-line":
                if (/[\r\n]/.test(node.data)) {
                    return false;
                }
        }

        // We now have a whitespace-only text node that may be rendered depending on its context. If it is adjacent to a
        // non-inline element, it will not be rendered. This seems to be a good enough definition.
        return isNonInlineElement(node.previousSibling) || isNonInlineElement(node.nextSibling);
    }

    function getRangeBoundaries(ranges) {
        var positions = [], i, range;
        for (i = 0; range = ranges[i++]; ) {
            positions.push(
                new DomPosition(range.startContainer, range.startOffset),
                new DomPosition(range.endContainer, range.endOffset)
            );
        }
        return positions;
    }

    function updateRangesFromBoundaries(ranges, positions) {
        for (var i = 0, range, start, end, len = ranges.length; i < len; ++i) {
            range = ranges[i];
            start = positions[i * 2];
            end = positions[i * 2 + 1];
            range.setStartAndEnd(start.node, start.offset, end.node, end.offset);
        }
    }

    function isSplitPoint(node, offset) {
        if (dom.isCharacterDataNode(node)) {
            if (offset == 0) {
                return !!node.previousSibling;
            } else if (offset == node.length) {
                return !!node.nextSibling;
            } else {
                return true;
            }
        }

        return offset > 0 && offset < node.childNodes.length;
    }

    function splitNodeAt(node, descendantNode, descendantOffset, positionsToPreserve) {
        var newNode, parentNode;
        var splitAtStart = (descendantOffset == 0);

        if (dom.isAncestorOf(descendantNode, node)) {
            log.info("splitNodeAt(): Descendant is ancestor of node");
            return node;
        }

        if (dom.isCharacterDataNode(descendantNode)) {
            var descendantIndex = dom.getNodeIndex(descendantNode);
            if (descendantOffset == 0) {
                descendantOffset = descendantIndex;
            } else if (descendantOffset == descendantNode.length) {
                descendantOffset = descendantIndex + 1;
            } else {
                throw module.createError("splitNodeAt() should not be called with offset in the middle of a data node (" +
                    descendantOffset + " in " + descendantNode.data);
            }
            descendantNode = descendantNode.parentNode;
        }

        if (isSplitPoint(descendantNode, descendantOffset)) {
            // descendantNode is now guaranteed not to be a text or other character node
            newNode = descendantNode.cloneNode(false);
            parentNode = descendantNode.parentNode;
            if (newNode.id) {
                newNode.removeAttribute("id");
            }
            var child, newChildIndex = 0;

            while ( (child = descendantNode.childNodes[descendantOffset]) ) {
                movePreservingPositions(child, newNode, newChildIndex++, positionsToPreserve);
            }
            movePreservingPositions(newNode, parentNode, dom.getNodeIndex(descendantNode) + 1, positionsToPreserve);
            return (descendantNode == node) ? newNode : splitNodeAt(node, parentNode, dom.getNodeIndex(newNode), positionsToPreserve);
        } else if (node != descendantNode) {
            newNode = descendantNode.parentNode;

            // Work out a new split point in the parent node
            var newNodeIndex = dom.getNodeIndex(descendantNode);

            if (!splitAtStart) {
                newNodeIndex++;
            }
            return splitNodeAt(node, newNode, newNodeIndex, positionsToPreserve);
        }
        return node;
    }

    function areElementsMergeable(el1, el2, attributeGroup) {
        return el1.namespaceURI == el2.namespaceURI &&
            el1.tagName.toLowerCase() == el2.tagName.toLowerCase() &&
            haveSameAttributeGroup(el1, el2, attributeGroup) &&
            getComputedStyleProperty(el1, "display") == "inline" &&
            getComputedStyleProperty(el2, "display") == "inline";
    }

    function createAdjacentMergeableTextNodeGetter(forward) {
        var siblingPropName = forward ? "nextSibling" : "previousSibling";

        return function(textNode, checkParentElement, attributeGroup) {
            var el = textNode.parentNode;
            var adjacentNode = textNode[siblingPropName];
            if (adjacentNode) {
                // Can merge if the node's previous/next sibling is a text node
                if (adjacentNode && adjacentNode.nodeType == 3) {
                    return adjacentNode;
                }
            } else if (checkParentElement) {
                // Compare text node parent element with its sibling
                adjacentNode = el[siblingPropName];
                log.info("adjacentNode: " + adjacentNode);
                if (adjacentNode && adjacentNode.nodeType == 1 && areElementsMergeable(el, adjacentNode, attributeGroup)) {
                    var adjacentNodeChild = adjacentNode[forward ? "firstChild" : "lastChild"];
                    if (adjacentNodeChild && adjacentNodeChild.nodeType == 3) {
                        return adjacentNodeChild;
                    }
                }
            }
            return null;
        };
    }

    var getPreviousMergeableTextNode = createAdjacentMergeableTextNodeGetter(false),
        getNextMergeableTextNode = createAdjacentMergeableTextNodeGetter(true);


    function Merge(firstNode) {
        this.isElementMerge = (firstNode.nodeType == 1);
        this.textNodes = [];
        var firstTextNode = this.isElementMerge ? firstNode.lastChild : firstNode;
        if (firstTextNode) {
            this.textNodes[0] = firstTextNode;
        }
    }

    Merge.prototype = {
        doMerge: function(positionsToPreserve) {
            var textNodes = this.textNodes;
            var firstTextNode = textNodes[0];
            if (textNodes.length > 1) {
                var firstTextNodeIndex = dom.getNodeIndex(firstTextNode);
                var textParts = [], combinedTextLength = 0, textNode, parent;
                forEach(textNodes, function(textNode, i) {
                    parent = textNode.parentNode;
                    if (i > 0) {
                        parent.removeChild(textNode);
                        if (!parent.hasChildNodes()) {
                            dom.removeNode(parent);
                        }
                        if (positionsToPreserve) {
                            forEach(positionsToPreserve, function(position) {
                                // Handle case where position is inside the text node being merged into a preceding node
                                if (position.node == textNode) {
                                    position.node = firstTextNode;
                                    position.offset += combinedTextLength;
                                }
                                // Handle case where both text nodes precede the position within the same parent node
                                if (position.node == parent && position.offset > firstTextNodeIndex) {
                                    --position.offset;
                                    if (position.offset == firstTextNodeIndex + 1 && i < len - 1) {
                                        position.node = firstTextNode;
                                        position.offset = combinedTextLength;
                                    }
                                }
                            });
                        }
                    }
                    textParts[i] = textNode.data;
                    combinedTextLength += textNode.data.length;
                });
                firstTextNode.data = textParts.join("");
            }
            return firstTextNode.data;
        },

        getLength: function() {
            var i = this.textNodes.length, len = 0;
            while (i--) {
                len += this.textNodes[i].length;
            }
            return len;
        },

        toString: function() {
            var textParts = [];
            forEach(this.textNodes, function(textNode, i) {
                textParts[i] = "'" + textNode.data + "'";
            });
            return "[Merge(" + textParts.join(",") + ")]";
        }
    };

    var optionProperties = ["elementTagName", "ignoreWhiteSpace", "applyToEditableOnly", "useExistingElements",
        "removeEmptyElements", "onElementCreate", "attributeGroup"];

    // TODO: Populate this with every attribute name that corresponds to a property with a different name. Really??
    var attrNamesForProperties = {};

    function AttributeApplier(attributeName, options, attributeValue) {
        var normalize, i, len, propName, applier = this, hasAttributeName = false;

        applier.attributeName = attributeName;
        applier.attributeValue = attributeValue === undefined ? "true" : attributeValue;

        // Initialize from options object
        if (typeof options == "object" && options !== null) {
            if (typeof options.elementTagName !== "undefined") {
                options.elementTagName = options.elementTagName.toLowerCase();
            }
            tagNames = options.tagNames;

            for (i = 0; propName = optionProperties[i++]; ) {
                if (options.hasOwnProperty(propName)) {
                    applier[propName] = options[propName];
                }
            }
            normalize = options.normalize;
        } else {
            normalize = options;
        }

        // check if attribute name is present in attributeGroup
        for (i = 0; i < applier.attributeGroup.length; i++) {
          if (applier.attributeGroup[i] === attributeName) {
            hasAttributeName = true;
            break;
          }
        }
        // add the attributeName if not in attributeGroup
        if (hasAttributeName === false) {
          applier.attributeGroup.push(attributeName);
        }

        // Backward compatibility: the second parameter can also be a Boolean indicating to normalize after unapplying
        applier.normalize = (typeof normalize == "undefined") ? true : normalize;

        // Initialize tag names
        applier.applyToAnyTagName = false;
        var type = typeof tagNames;
        if (type == "string") {
            if (tagNames == "*") {
                applier.applyToAnyTagName = true;
            } else {
                applier.tagNames = trim(tagNames.toLowerCase()).split(/\s*,\s*/);
            }
        } else if (type == "object" && typeof tagNames.length == "number") {
            applier.tagNames = [];
            for (i = 0, len = tagNames.length; i < len; ++i) {
                if (tagNames[i] == "*") {
                    applier.applyToAnyTagName = true;
                } else {
                    applier.tagNames.push(tagNames[i].toLowerCase());
                }
            }
        } else {
            applier.tagNames = [applier.elementTagName];
        }
    }

    AttributeApplier.prototype = {
        elementTagName: defaultTagName,
        ignoreWhiteSpace: true,
        applyToEditableOnly: false,
        useExistingElements: true,
        removeEmptyElements: true,
        onElementCreate: null,
        attributeGroup: [],

        appliesToElement: function(el) {
            return contains(this.tagNames, el.tagName.toLowerCase());
        },

        getEmptyElements: function(range) {
            var applier = this;
            return range.getNodes([1], function(el) {
                return applier.appliesToElement(el) && !el.hasChildNodes();
            });
        },

        getSelfOrAncestorWithAttribute: function(node) {
            while (node) {
                if (node.nodeType === 1 && (this.applyToAnyTagName || this.appliesToElement(node)) && node.hasAttribute(this.attributeName) && node.getAttribute(this.attributeName) === this.attributeValue) {
                    return node;
                }
                node = node.parentNode;
            }
            return null;
        },

        isModifiable: function(node) {
            return !this.applyToEditableOnly || isEditable(node);
        },

        // White space adjacent to an unwrappable node can be ignored for wrapping
        isIgnorableWhiteSpaceNode: function(node) {
            return this.ignoreWhiteSpace && node && node.nodeType == 3 && isUnrenderedWhiteSpaceNode(node);
        },

        // Normalizes nodes after applying an attribute to a Range.
        postApply: function(textNodes, range, positionsToPreserve, isUndo) {
            log.group("postApply " + range.toHtml());
            var firstNode = textNodes[0], lastNode = textNodes[textNodes.length - 1];
            var merges = [], currentMerge;
            var rangeStartNode = firstNode, rangeEndNode = lastNode;
            var rangeStartOffset = 0, rangeEndOffset = lastNode.length;
            var precedingTextNode;
            var attributeGroup = this.attributeGroup;

            // Check for every required merge and create a Merge object for each
            forEach(textNodes, function(textNode) {
                precedingTextNode = getPreviousMergeableTextNode(textNode, !isUndo, attributeGroup);
                log.debug("Checking for merge. text node: " + textNode.data + ", parent: " + dom.inspectNode(textNode.parentNode) + ", preceding: " + dom.inspectNode(precedingTextNode));
                if (precedingTextNode) {
                    if (!currentMerge) {
                        currentMerge = new Merge(precedingTextNode);
                        merges.push(currentMerge);
                    }
                    currentMerge.textNodes.push(textNode);
                    if (textNode === firstNode) {
                        rangeStartNode = currentMerge.textNodes[0];
                        rangeStartOffset = rangeStartNode.length;
                    }
                    if (textNode === lastNode) {
                        rangeEndNode = currentMerge.textNodes[0];
                        rangeEndOffset = currentMerge.getLength();
                    }
                } else {
                    currentMerge = null;
                }
            });

            // Test whether the first node after the range needs merging
            var nextTextNode = getNextMergeableTextNode(lastNode, !isUndo, this.attributeGroup);

            if (nextTextNode) {
                if (!currentMerge) {
                    currentMerge = new Merge(lastNode);
                    merges.push(currentMerge);
                }
                currentMerge.textNodes.push(nextTextNode);
            }

            // Apply the merges
            if (merges.length) {
                log.info("Merging. Merges:", merges);
                for (var i = 0, len = merges.length; i < len; ++i) {
                    merges[i].doMerge(positionsToPreserve);
                }
                log.info(rangeStartNode.nodeValue, rangeStartOffset, rangeEndNode.nodeValue, rangeEndOffset);

                // Set the range boundaries
                range.setStartAndEnd(rangeStartNode, rangeStartOffset, rangeEndNode, rangeEndOffset);
                log.info("Range after merge: " + range.inspect());
            }
            // check if parent has siblings and if grand parent is also a valid tagname
            log.groupEnd();
        },

        createContainer: function(parentNode) {
            log.debug("createContainer with namespace " + parentNode.namespaceURI);
            var doc = dom.getDocument(parentNode);
            var namespace;
            var el = createElementNSSupported && !dom.isHtmlNamespace(parentNode) && (namespace = parentNode.namespaceURI) ?
                doc.createElementNS(parentNode.namespaceURI, this.elementTagName) :
                doc.createElement(this.elementTagName);

            el.setAttribute(this.attributeName, this.attributeValue);
            if (this.onElementCreate) {
                this.onElementCreate(el, this);
            }
            return el;
        },

        elementHasNoActiveAttributes: function(el, attributeGroup, attributeName) {
            // do not check the applier attribute since it is the one to be removed
            var attribute;
            for (var i = 0; i < attributeGroup.length; i++) {
                attribute = attributeGroup[i];
                if (attributeName !== attribute && el.hasAttribute(attribute) && el.getAttribute(attribute) !== "false") {
                  return false;
                }
            }
            return true;
        },

        applyToTextNode: function(textNode, positionsToPreserve) {
            log.group("Apply attribute '" + this.attributeName + "'. textNode: " + textNode.data);
            log.info("Apply attribute  '" + this.attributeName + "'. textNode: " + textNode.data);

            // Check whether the text node can be styled. Text within a <style> or <script> element, for example,
            // should not be styled. See issue 283.
            if (canTextBeStyled(textNode)) {
                var parent = textNode.parentNode;
                if (parent.childNodes.length == 1 &&
                    this.useExistingElements &&
                    this.appliesToElement(parent)) {

                    parent.setAttribute(this.attributeName, this.attributeValue);
                } else {
                    var textNodeParent = textNode.parentNode;
                    var el = this.createContainer(textNodeParent);
                    textNodeParent.insertBefore(el, textNode);
                    el.appendChild(textNode);
                }
            }

            log.groupEnd();
        },

        isRemovable: function(el) {
            return el.tagName.toLowerCase() == this.elementTagName &&
                this.elementHasNoActiveAttributes(el, this.attributeGroup, this.attributeName) &&
                this.isModifiable(el);
        },

        isEmptyContainer: function(el) {
            var childNodeCount = el.childNodes.length;
            return el.nodeType == 1 &&
                this.isRemovable(el) &&
                (childNodeCount == 0 || (childNodeCount == 1 && this.isEmptyContainer(el.firstChild)));
        },

        removeEmptyContainers: function(range) {
            var applier = this;
            var nodesToRemove = range.getNodes([1], function(el) {
                return applier.isEmptyContainer(el);
            });

            var rangesToPreserve = [range];
            var positionsToPreserve = getRangeBoundaries(rangesToPreserve);

            forEach(nodesToRemove, function(node) {
                log.debug("Removing empty container " + dom.inspectNode(node));
                removePreservingPositions(node, positionsToPreserve);
            });

            // Update the range from the preserved boundary positions
            updateRangesFromBoundaries(rangesToPreserve, positionsToPreserve);
        },

        undoToTextNode: function(textNode, range, ancestorWithAttribute, positionsToPreserve) {
            log.info("undoToTextNode", dom.inspectNode(textNode), range.inspect(), dom.inspectNode(ancestorWithAttribute), range.containsNode(ancestorWithAttribute));
            if (!range.containsNode(ancestorWithAttribute)) {
                // Split out the portion of the ancestor from which we can remove the attribute
                //var parent = ancestorWithAttribute.parentNode, index = dom.getNodeIndex(ancestorWithAttribute);
                var ancestorRange = range.cloneRange();
                ancestorRange.selectNode(ancestorWithAttribute);
                log.info("range end in ancestor " + ancestorRange.isPointInRange(range.endContainer, range.endOffset) + ", isSplitPoint " + isSplitPoint(range.endContainer, range.endOffset));
                if (ancestorRange.isPointInRange(range.endContainer, range.endOffset)) {
                    splitNodeAt(ancestorWithAttribute, range.endContainer, range.endOffset, positionsToPreserve);
                    range.setEndAfter(ancestorWithAttribute);
                }
                if (ancestorRange.isPointInRange(range.startContainer, range.startOffset)) {
                    ancestorWithAttribute = splitNodeAt(ancestorWithAttribute, range.startContainer, range.startOffset, positionsToPreserve);
                }
            }

            log.info("isRemovable", this.isRemovable(ancestorWithAttribute), dom.inspectNode(ancestorWithAttribute), "'" + ancestorWithAttribute.innerHTML + "'", "'" + ancestorWithAttribute.parentNode.innerHTML + "'");
            if (this.isRemovable(ancestorWithAttribute)) {
                replaceWithOwnChildrenPreservingPositions(ancestorWithAttribute, positionsToPreserve);
            } else {
                ancestorWithAttribute.removeAttribute(this.attributeName);
            }
        },

        splitAncestorWithAttribute: function(container, offset, positionsToPreserve) {
            var ancestorWithAttribute = this.getSelfOrAncestorWithAttribute(container);
            if (ancestorWithAttribute) {
                log.info("splitAncestorWithAttribute", dom.inspectNode(ancestorWithAttribute), dom.inspectNode(container), offset);
                splitNodeAt(ancestorWithAttribute, container, offset, positionsToPreserve);
            }
        },

        undoToAncestor: function(ancestorWithAttribute, positionsToPreserve) {
            log.info("isRemovable", this.isRemovable(ancestorWithAttribute), dom.inspectNode(ancestorWithAttribute), "'" + ancestorWithAttribute.innerHTML + "'", "'" + ancestorWithAttribute.parentNode.innerHTML + "'");
            if (this.isRemovable(ancestorWithAttribute)) {
                replaceWithOwnChildrenPreservingPositions(ancestorWithAttribute, positionsToPreserve);
            } else {
                ancestorWithAttribute.removeAttribute(this.attributeName);
            }
        },

        applyToRange: function(range, rangesToPreserve) {
            var applier = this;
            rangesToPreserve = rangesToPreserve || [];

            // Create an array of range boundaries to preserve
            var positionsToPreserve = getRangeBoundaries(rangesToPreserve || []);

            range.splitBoundariesPreservingPositions(positionsToPreserve);

            // Tidy up the DOM by removing empty containers
            if (applier.removeEmptyElements) {
                applier.removeEmptyContainers(range);
            }

            var textNodes = getEffectiveTextNodes(range);

            if (textNodes.length) {
                forEach(textNodes, function(textNode) {
                    log.info("textnode " + textNode.data + " is ignorable: " + applier.isIgnorableWhiteSpaceNode(textNode));
                    if (!applier.isIgnorableWhiteSpaceNode(textNode) && !applier.getSelfOrAncestorWithAttribute(textNode) &&
                            applier.isModifiable(textNode)) {
                        applier.applyToTextNode(textNode, positionsToPreserve);
                    }
                });
                var lastTextNode = textNodes[textNodes.length - 1];
                range.setStartAndEnd(textNodes[0], 0, lastTextNode, lastTextNode.length);
                if (applier.normalize) {
                    applier.postApply(textNodes, range, positionsToPreserve, false);
                }

                // Update the ranges from the preserved boundary positions
                updateRangesFromBoundaries(rangesToPreserve, positionsToPreserve);
            }

            // Apply attribute to any appropriate empty elements
            var emptyElements = applier.getEmptyElements(range);

            forEach(emptyElements, function(el) {
                el.setAttribute(applier.attributeName, applier.attributeValue);
            });
        },

        applyToRanges: function(ranges) {
            log.group("applyToRanges");

            var i = ranges.length;
            while (i--) {
                this.applyToRange(ranges[i], ranges);
            }

            log.groupEnd();

            return ranges;
        },

        applyToSelection: function(win) {
            log.group("applyToSelection");
            var sel = api.getSelection(win);
            log.info("applyToSelection " + sel.inspect());
            sel.setRanges( this.applyToRanges(sel.getAllRanges()) );
            log.groupEnd();
        },

        undoToRange: function(range, rangesToPreserve) {
            var applier = this;
            // Create an array of range boundaries to preserve
            rangesToPreserve = rangesToPreserve || [];
            var positionsToPreserve = getRangeBoundaries(rangesToPreserve);

            log.info("undoToRange " + range.inspect(), positionsToPreserve);

            range.splitBoundariesPreservingPositions(positionsToPreserve);

            // Tidy up the DOM by removing empty containers
            if (applier.removeEmptyElements) {
                applier.removeEmptyContainers(range, positionsToPreserve);
            }

            var textNodes = getEffectiveTextNodes(range);
            var textNode, ancestorWithAttribute;
            var lastTextNode = textNodes[textNodes.length - 1];

            if (textNodes.length) {
                applier.splitAncestorWithAttribute(range.endContainer, range.endOffset, positionsToPreserve);
                applier.splitAncestorWithAttribute(range.startContainer, range.startOffset, positionsToPreserve);
                for (var i = 0, len = textNodes.length; i < len; ++i) {
                    textNode = textNodes[i];
                    ancestorWithAttribute = applier.getSelfOrAncestorWithAttribute(textNode);
                    if (ancestorWithAttribute && applier.isModifiable(textNode)) {
                        applier.undoToAncestor(ancestorWithAttribute, positionsToPreserve);
                    }
                }
                // Ensure the range is still valid
                range.setStartAndEnd(textNodes[0], 0, lastTextNode, lastTextNode.length);

                log.info("Undo set range to '" + textNodes[0].data + "', '" + textNode.data + "'");

                if (applier.normalize) {
                    applier.postApply(textNodes, range, positionsToPreserve, true);
                }

                // Update the ranges from the preserved boundary positions
                updateRangesFromBoundaries(rangesToPreserve, positionsToPreserve);
            }

            // Remove attribute from any appropriate empty elements
            var emptyElements = applier.getEmptyElements(range);

            forEach(emptyElements, function(el) {
                el.removeAttribute(applier.attributeName);
            });
        },

        undoToRanges: function(ranges) {
            // Get ranges returned in document order
            var i = ranges.length;

            while (i--) {
                this.undoToRange(ranges[i], ranges);
            }
            log.groupEnd();

            return ranges;
        },

        undoToSelection: function(win) {
            var sel = api.getSelection(win);
            var ranges = api.getSelection(win).getAllRanges();
            this.undoToRanges(ranges);
            sel.setRanges(ranges);
        },

        isAppliedToRange: function(range) {
            if (range.collapsed || range.toString() == "") {
                return !!this.getSelfOrAncestorWithAttribute(range.commonAncestorContainer);
            } else {
                var textNodes = range.getNodes( [3] );
                if (textNodes.length)
                for (var i = 0, textNode; textNode = textNodes[i++]; ) {
                    if (!this.isIgnorableWhiteSpaceNode(textNode) && rangeSelectsAnyText(range, textNode) &&
                            this.isModifiable(textNode) && !this.getSelfOrAncestorWithAttribute(textNode)) {
                        return false;
                    }
                }
                return true;
            }
        },

        isAppliedToRanges: function(ranges) {
            var i = ranges.length;
            if (i == 0) {
                return false;
            }
            while (i--) {
                if (!this.isAppliedToRange(ranges[i])) {
                    return false;
                }
            }
            return true;
        },

        isAppliedToSelection: function(win) {
            var sel = api.getSelection(win);
            return this.isAppliedToRanges(sel.getAllRanges());
        },

        toggleRange: function(range) {
            if (this.isAppliedToRange(range)) {
                this.undoToRange(range);
            } else {
                this.applyToRange(range);
            }
        },

        toggleSelection: function(win) {
            if (this.isAppliedToSelection(win)) {
                this.undoToSelection(win);
            } else {
                this.applyToSelection(win);
            }
        },

        getElementsWithAttributeIntersectingRange: function(range) {
            var elements = [];
            var applier = this;
            range.getNodes([3], function(textNode) {
                var el = applier.getSelfOrAncestorWithAttribute(textNode);
                if (el && !contains(elements, el)) {
                    elements.push(el);
                }
            });
            return elements;
        },

        detach: function() {}
    };

    function createAttributeApplier(attributeName, options, attributeValue) {
        return new AttributeApplier(attributeName, options, attributeValue);
    }

    AttributeApplier.util = {
        replaceWithOwnChildren: replaceWithOwnChildrenPreservingPositions,
        haveSameAttributeGroup: haveSameAttributeGroup,
        splitNodeAt: splitNodeAt,
        isEditableElement: isEditableElement,
        isEditingHost: isEditingHost,
        isEditable: isEditable
    };

    api.AttributeApplier = AttributeApplier;
    api.createAttributeApplier = createAttributeApplier;
});
/* build:modularizeEnd */
