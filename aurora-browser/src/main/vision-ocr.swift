import Cocoa
import Vision

func performOCR() {
    let cgImage = CGWindowListCreateImage(
        CGRect.infinite,
        .optionOnScreenOnly,
        kCGNullWindowID,
        .boundsIgnoreFraming
    )
    
    guard let image = cgImage else {
        print("[]")
        return
    }
    
    let scale = NSScreen.main?.backingScaleFactor ?? 2.0
    
    let requestHandler = VNImageRequestHandler(cgImage: image, options: [:])
    let request = VNRecognizeTextRequest { (request, error) in
        guard let observations = request.results as? [VNRecognizedTextObservation] else {
            print("[]")
            return
        }
        
        let physicalWidth = CGFloat(image.width)
        let physicalHeight = CGFloat(image.height)
        
        var results: [String] = []
        for observation in observations {
            guard let topCandidate = observation.topCandidates(1).first else { continue }
            let text = topCandidate.string
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: " ")
            
            let boundingBox = observation.boundingBox
            
            // Vision gives normalized coordinates (0 to 1), origin is BOTTOM-LEFT
            let physX = boundingBox.origin.x * physicalWidth
            let physY = (1.0 - boundingBox.origin.y - boundingBox.size.height) * physicalHeight
            let physW = boundingBox.size.width * physicalWidth
            let physH = boundingBox.size.height * physicalHeight
            
            // Convert to logical CSS points
            let logicalX = physX / scale
            let logicalY = physY / scale
            let logicalW = physW / scale
            let logicalH = physH / scale
            
            results.append("{\"text\":\"\(text)\",\"role\":\"text\",\"bounds\":{\"x\":\(logicalX),\"y\":\(logicalY),\"width\":\(logicalW),\"height\":\(logicalH)}}")
        }
        print("[\n" + results.joined(separator: ",\n") + "\n]")
    }
    
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false
    
    do {
        try requestHandler.perform([request])
    } catch {
        print("[]")
    }
}

performOCR()
