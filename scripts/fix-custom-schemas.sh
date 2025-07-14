#!/bin/bash

# Fix Custom Dgraph Schemas
# This script converts type definitions from GraphQL-style to Dgraph-style

echo "🔧 Fixing custom Dgraph schemas..."

# Function to fix a schema file
fix_schema() {
    local file=$1
    local token=$(basename "$file" .dgraph)
    
    echo "Processing $token schema..."
    
    # Create a temporary file
    temp_file="/tmp/${token}_fixed.dgraph"
    
    # Read the file and process it
    awk '
    BEGIN { in_type = 0; type_name = ""; }
    
    # Match type definitions
    /^type [A-Za-z0-9]+ {/ {
        in_type = 1;
        type_name = $2;
        print "# " $0;  # Comment out the original line
        next;
    }
    
    # Inside a type definition
    in_type == 1 && /^  [a-zA-Z0-9.]+:/ {
        # Extract field name (before the colon)
        field = $1;
        gsub(/:/, "", field);
        
        # Store the full predicate definition for later
        predicate_defs[field] = $0;
        
        # Print just the field name for the type definition
        print "  " field;
        next;
    }
    
    # End of type definition
    in_type == 1 && /^}/ {
        print $0;
        print "";
        
        # Now print all the predicate definitions
        print "# Predicates for " type_name;
        for (field in predicate_defs) {
            # Remove the leading spaces and print as predicate
            gsub(/^  /, "", predicate_defs[field]);
            # Add the dot at the end if not present
            if (predicate_defs[field] !~ /\.$/) {
                predicate_defs[field] = predicate_defs[field] " .";
            }
            print predicate_defs[field];
        }
        print "";
        
        # Clear the array
        delete predicate_defs;
        in_type = 0;
        type_name = "";
        next;
    }
    
    # Pass through other lines
    { print $0; }
    ' "$file" > "$temp_file"
    
    # Replace the original file
    mv "$temp_file" "$file"
    echo "✅ Fixed $token schema"
}

# Fix all custom schema files
for schema_file in /home/jr/dlux/honeygraph/schema/custom/*.dgraph; do
    if [ -f "$schema_file" ]; then
        fix_schema "$schema_file"
    fi
done

echo "✨ All custom schemas fixed!"