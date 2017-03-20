
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (handlers[request.method]) {
    var result = handlers[request.method](request);
    if (typeof result.then == "function") {
      result.then(sendResponse);
      return true;
    }
    else sendResponse(result);
  }
})


var handlers = new function() {
  this.raCheck = function(request) {
    return true;
  }

  this.raGetInfo = function(request) {
    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || $("html").attr("xml:lang") || $("meta[http-equiv=content-language]").attr("content")
    }
  }

  this.raGetCurrentIndex = function(request) {
    if (getSelectedText()) return -100;
    else {
      return docProvider.getDoc()
        .then(function(doc) {return doc.getCurrentIndex()});
    }
  }

  this.raGetTexts = function(request) {
    if (request.index < 0) {
      if (request.index == -100) return getSelectedText();
      else return null;
    }
    else {
      return docProvider.getDoc()
        .then(function(doc) {return doc.getTexts(request.index)})
        .then(function(texts) {
          if (texts) {
            texts = texts.map(removeLinks);
            console.log(texts.join("\n\n"));
          }
          return texts;
        })
    }
  }

  function getSelectedText() {
    return window.getSelection().toString().trim();
  }
}


var docProvider = new function() {
  var doc;

  this.getDoc = function() {
    if (doc) return Promise.resolve(doc);
    else return ready().then(function() {return doc = createDoc()});
  }

  function ready() {
    return new Promise(function(fulfill) {
      return $(fulfill);
    })
  }

  function createDoc() {
    if (location.hostname == "docs.google.com") {
      if ($(".kix-appview-editor").length) return new GoogleDoc();
      else if ($(".drive-viewer-paginated-scrollable").length) return new GDriveDoc();
      else return new HtmlDoc();
    }
    else if (location.hostname == "drive.google.com") return new GDriveDoc();
    else return new HtmlDoc();
  }
}


function GoogleDoc() {
  var container = $(".kix-appview-editor").get(0);
  var pages = $(".kix-page");

  this.getCurrentIndex = function() {
    for (var i=0; i<pages.length; i++) if (pages.eq(i).position().top > container.scrollTop+$(container).height()/2) break;
    return i-1;
  }

  this.getTexts = function(index) {
    var page = pages.get(index);
    if (page) {
      container.scrollTop = $(page).position().top;
      return waitMillis(1000)
        .then(function() {
          return $(".kix-paragraphrenderer", page).get().map(getText).filter(isNotEmpty);
        })
    }
    else return null;
  }
}


function GDriveDoc() {
  var container = $(".drive-viewer-paginated-scrollable").get(0);
  var pages = $(".drive-viewer-paginated-page");

  this.getCurrentIndex = function() {
    for (var i=0; i<pages.length; i++) if (pages.eq(i).position().top > container.scrollTop+$(container).height()/2) break;
    return i-1;
  }

  this.getTexts = function(index) {
    var page = pages.get(index);
    if (page) {
      container.scrollTop = $(page).position().top;
      return waitMillis(2000)
        .then(function() {
          return $("p", page).get().map(getText).filter(isNotEmpty);
        })
        .then(fixParagraphs)
    }
    else return null;
  }

  function fixParagraphs(texts) {
    var out = [];
    var para = "";
    for (var i=0; i<texts.length; i++) {
      if (para) para += " ";
      para += texts[i];
      if (texts[i].match(/[.!?]$/)) {
        out.push(para);
        para = "";
      }
    }
    if (para) out.push(para);
    return out;
  }
}


function HtmlDoc() {
  var headingTags = ["H1", "H2", "H3", "H4", "H5", "H6"];
  var paragraphTags = ["P", "BLOCKQUOTE", "PRE"];
  var listTags = ["OL", "UL"];

  this.getCurrentIndex = function() {
    return 0;
  }

  this.getTexts = function(index) {
    if (index == 0) return this.texts || (this.texts = parse());
    else return null;
  }

  function parse() {
    //clear markers
    $(".read-aloud").removeClass("read-aloud");

    //find text blocks with at least 1 paragraphs
    var textBlocks = $("p").not("blockquote > p").parent().get();
    $.uniqueSort(textBlocks);

    //visible only
    textBlocks = $(textBlocks).filter(":visible").filter(notOutOfView).get();

    if (textBlocks.length) {
      //remove any block less than 1/7 the length of the longest block
      var lengths = textBlocks.map(function(block) {
        return $(block).children(paragraphTags.join(", ")).text().length;
      });
      var longest = Math.max.apply(null, lengths);
      textBlocks = textBlocks.filter(function(block, index) {
        return lengths[index] > longest/7;
      });

      //mark the elements to be read
      textBlocks.forEach(function(block) {
        $(findHeadingsFor(block)).addClass("read-aloud");
        $(block).children(headingTags.concat(paragraphTags).join(", ")).addClass("read-aloud");
        $(block).children(listTags.join(", ")).children("li").addClass("read-aloud");
      });
    }
    else {
      //if no text blocks found, read all headings
      $(headingTags.concat(paragraphTags).join(", ")).filter(":visible").addClass("read-aloud");
    }

    //extract texts
    var texts = $(".read-aloud").get().map(getText).filter(isNotEmpty);
    return texts;
  }

  function findHeadingsFor(block) {
    var result = [];
    var firstInnerElem = $(block).children(headingTags.concat(paragraphTags).join(", ")).get(0);
    var currentLevel = getHeadingLevel(firstInnerElem);
    var node = previousNode(firstInnerElem, true);
    while (node && !$(node).hasClass("read-aloud")) {
      if (node.nodeType == 1) {
        var level = getHeadingLevel(node);
        if (level < currentLevel) {
          result.push(node);
          currentLevel = level;
        }
      }
      node = previousNode(node);
    }
    return result.reverse();
  }

  function getHeadingLevel(elem) {
    var index = elem ? headingTags.indexOf(elem.tagName) : -1;
    return index == -1 ? 100 : index + 1;
  }

  function previousNode(node, skipChildren) {
    if (node == document.body) return null;
    if (node.nodeType == 1 && !skipChildren && node.lastChild) return node.lastChild;
    if (node.previousSibling) return node.previousSibling;
    return previousNode(node.parentNode, true);
  }
}


function notOutOfView() {
  return $(this).offset().left >= 0;
}

function getText(elem) {
  $(elem).find(":hidden, sup").remove();
  var text = $(elem).text().trim();
  if (elem.tagName == "LI") return ($(elem).index() + 1) + ". " + text;
  else return text;
}

function isNotEmpty(text) {
  return text;
}

function removeLinks(text) {
  return text.replace(/https?:\/\/\S+/g, "this URL.");
}
