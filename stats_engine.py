import sys
import json
import math
import statistics

def process_data(data):
    # Data is expected to be a list of numeric values or objects
    # For simplicity, we'll calculate stats for distance, displacement, time, speed, velocity
    # if provided in the input objects
    
    results = {}
    
    metrics = ['distance', 'displacement', 'time', 'speed', 'velocity', 'acceleration', 'retardation']
    
    for metric in metrics:
        values = [d.get(metric) for d in data if d.get(metric) is not None]
        if len(values) >= 1:
            try:
                results[metric] = {
                    'mean': statistics.mean(values),
                    'median': statistics.median(values),
                    'stdev': statistics.stdev(values) if len(values) > 1 else 0,
                    'variance': statistics.variance(values) if len(values) > 1 else 0,
                    'min': min(values),
                    'max': max(values),
                    'sum': sum(values)
                }
            except statistics.StatisticsError:
                results[metric] = None
        else:
            results[metric] = None
            
    return results

if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"error": "No input data"}))
            sys.exit(0)
            
        data = json.loads(input_data)
        processed = process_data(data)
        print(json.dumps(processed))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
