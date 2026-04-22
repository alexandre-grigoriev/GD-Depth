# SAV AI Assistant - Project Documentation

## Project Overview

**SAV AI Assistant** (aisav-chat) is a Retrieval-Augmented Generation (RAG) chatbot application that enables users to ask questions and receive AI-generated answers grounded in a custom knowledge base. The application provides a web-based chat interface where users can upload documents (PDF, CSV, Excel, TXT), which get ingested into an AWS Bedrock Knowledge Base, and then query the knowledge base through natural language questions answered by a large language model (Claude 3 Sonnet via AWS Bedrock).

### Key Features

- **Conversational AI Chat**: Real-time streaming chat interface powered by Claude 3 Sonnet (via AWS Bedrock + LiteLLM)
- **Document Upload & Ingestion**: Upload PDF, CSV, Excel, and TXT files directly through the sidebar UI
- **PDF-to-Markdown Conversion**: Converts uploaded PDFs to markdown with image extraction using a customized PyMuPDF4LLM library
- **AWS Bedrock Knowledge Base Integration**: Retrieves relevant context from AWS Bedrock Knowledge Bases using vector similarity search
- **Image Handling**: Extracts images from PDFs, stores them on S3, and renders them inline in chat responses
- **Multi-Knowledge Base Support**: Queries across multiple knowledge bases simultaneously
- **Dual Backend Support**: Supports both AWS Knowledge Base (`AWS_KB`) and a custom server-based graph database (`ServerGDB`) as data backends

---

## Architecture

### High-Level Architecture Diagram

```
+-------------------+       +-------------------+       +------------------------+
|                   |       |                   |       |                        |
|   Streamlit UI    +------>+   LiteLLM (LLM    +------>+   AWS Bedrock          |
|   (Frontend)      |       |   Gateway)        |       |   Claude 3 Sonnet      |
|                   |       |                   |       |                        |
+--------+----------+       +-------------------+       +------------------------+
         |
         |  User Query
         v
+-------------------+       +------------------------+
|                   |       |                        |
|   RAG Pipeline    +------>+   AWS Bedrock           |
|   (Context        |       |   Knowledge Base        |
|    Retrieval)     |       |   (Vector Search)       |
|                   |       |                        |
+-------------------+       +----------+-------------+
                                       |
                                       v
                            +------------------------+
                            |                        |
                            |   AWS S3 Bucket        |
                            |   (Document Storage)   |
                            |                        |
                            +------------------------+
```

### Application Flow

1. **User sends a question** via the Streamlit chat input
2. **Context retrieval**: The question is sent to AWS Bedrock Knowledge Base(s) for vector similarity search, retrieving the top-N most relevant document chunks
3. **Prompt construction**: The retrieved context is injected into a system prompt along with the user's question
4. **LLM inference**: The prompt is sent to Claude 3 Sonnet (via LiteLLM) for streaming response generation
5. **Response rendering**: The streamed response is displayed in the chat UI, with inline images rendered from S3

### Document Ingestion Flow

1. **User uploads files** through the sidebar file uploader
2. **PDF processing**: PDFs are converted to markdown text using a customized `pymupdf4llm` library; images are extracted and saved locally
3. **S3 upload**: Converted text files and extracted images are uploaded to separate S3 buckets
4. **Knowledge Base sync**: An ingestion job is triggered on AWS Bedrock to sync the data source with the knowledge base
5. **Polling**: The app polls the ingestion job status until completion

---

## Project Structure

```
aisav-chat/
|-- streamlit_page.py          # Main application (UI, chat logic, file upload, RAG pipeline)
|-- static_vars.py             # Constants: file paths, system prompts, message templates
|-- settings.json              # Runtime configuration (AWS keys, model, KB IDs, query params)
|-- requirements.txt           # Python dependencies
|-- README.md                  # Basic setup instructions
|-- images/                    # Temporary local storage for extracted PDF images
|-- tmp_images/                # Cache for downloaded S3 images displayed in chat
|-- res/
|   |-- settings copy.json     # Backup/alternate settings configuration
|   |-- test_pdf_markdown.ipynb # Notebook for testing PDF-to-markdown conversion
|   |-- pymupdf4llm_updated/   # Customized fork of pymupdf4llm library
|       |-- __init__.py
|       |-- helpers/
|       |   |-- pymupdf_rag.py       # Core PDF-to-markdown converter (tables, images, headers)
|       |   |-- get_text_lines.py     # Text line extraction and reading order detection
|       |   |-- multi_column.py       # Multi-column page layout detection
|       |-- llama/
|           |-- pdf_markdown_reader.py # LlamaIndex-compatible PDF reader (optional integration)
```

### File Descriptions

| File | Purpose |
|------|---------|
| `streamlit_page.py` | Main entry point. Contains the Streamlit UI, chat logic, RAG retrieval, file upload/ingestion pipeline, PDF conversion, S3 operations, and image handling. |
| `static_vars.py` | Defines constants including `SETTINGS_PATH`, `FEEDBACK_PATH`, system prompt (`SYSTEM_PROMPT_ANSWER`), and the initial message template (`MESSAGE_ANSWER`). |
| `settings.json` | JSON configuration file storing AWS credentials, model name, knowledge base IDs, data source IDs, S3 bucket names, environment variables, and query parameters. |
| `res/pymupdf4llm_updated/` | A customized fork of the `pymupdf4llm` library with modifications for image extraction (saves images locally with custom naming for S3 upload). |

---

## Tools & Technologies

### Core Framework

| Tool | Version/Details | Purpose |
|------|----------------|---------|
| **Python** | 3.11.0 | Runtime language |
| **Streamlit** | Latest | Web UI framework for the chat interface and file management sidebar |

### AI / LLM

| Tool | Purpose |
|------|---------|
| **LiteLLM** | Unified LLM API gateway; routes requests to AWS Bedrock models |
| **AWS Bedrock** | Managed LLM service hosting Claude 3 Sonnet (`anthropic.claude-3-sonnet-20240229-v1:0`) |
| **AWS Bedrock Knowledge Bases** | Managed RAG service providing vector similarity search over ingested documents |

### AWS Services

| Service | Purpose |
|---------|---------|
| **AWS Bedrock Agent Runtime** | Retrieves relevant document chunks from knowledge bases via vector search |
| **AWS Bedrock Agent** | Manages ingestion jobs to sync S3 data sources with knowledge bases |
| **AWS S3** | Stores uploaded documents (`aisav-chat-databank`) and extracted images (`aisav-chat-images`) |

### Document Processing

| Tool | Purpose |
|------|---------|
| **PyMuPDF (fitz)** | Low-level PDF parsing, text extraction, table detection, and image extraction |
| **pymupdf4llm** (customized) | Converts PDF pages to LLM-friendly markdown with header detection, multi-column support, table formatting, and image extraction |
| **Pillow (PIL)** | Image format conversion for S3 upload |

### Python Libraries

| Library | Purpose |
|---------|---------|
| **boto3** | AWS SDK for Python - S3 operations, Bedrock agent runtime, knowledge base management |
| **requests** | HTTP client for the alternative `ServerGDB` backend |
| **json** | Configuration file parsing |
| **re** | Regex parsing for inline image references (`[imageurl:filename.ext]`) |
| **shutil** | File system operations (cleanup of temporary image folders) |

### Optional / Extended

| Tool | Purpose |
|------|---------|
| **LlamaIndex** | Optional integration via `PDFMarkdownReader` for LlamaIndex-compatible document loading |

---

## Configuration

The application is configured via `settings.json` with the following structure:

| Key | Description |
|-----|-------------|
| `Llm_framework` | LLM framework in use (`Litellm`) |
| `BDtype` | Database backend type (`AWS_KB` or `ServerGDB`), split strategy, markdown conversion flag, chunk length |
| `keys.AWS_ACCESS_KEY_ID` | AWS access key for authentication |
| `keys.AWS_SECRET_ACCESS_KEY` | AWS secret key for authentication |
| `keys.AWS_REGION_NAME` | AWS region (default: `us-east-1`) |
| `keys.AWS_Model_NAME` | LLM model identifier (e.g., `bedrock/anthropic.claude-3-sonnet-20240229-v1:0`) |
| `keys.knowledge_base_id` | List of AWS Bedrock Knowledge Base IDs to query |
| `keys.data_source_id` | List of corresponding data source IDs for ingestion sync |
| `keys.s3_name` | S3 bucket name for document storage |
| `keys.s3-images` | S3 bucket name for image storage |
| `var_env` | Environment variables to set at runtime, and the model name for LiteLLM |
| `kn_query` | Query parameters: `[numberOfResults, ?, searchType]` |

---

## How to Run

```bash
# 1. Create a virtual environment (Python 3.11.0)
python -m venv .venv

# 2. Activate the virtual environment
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure settings.json with your AWS credentials and knowledge base IDs

# 5. Run the application
streamlit run streamlit_page.py
```

---

## RAG Pipeline Details

### Retrieval Strategy

- **Engine**: AWS Bedrock Knowledge Base (managed vector store)
- **Search type**: Vector similarity search
- **Top-K results**: Configurable via `kn_query[0]` (default: 10)
- **Multi-KB**: Iterates over all configured knowledge base IDs, aggregating context from each

### Prompt Engineering

The system uses a multi-turn prompt structure:

1. **System instruction** (as user message): Defines the agent's behavior - answer only from context, preserve image URLs, respond in markdown
2. **Context injection**: Retrieved document chunks are provided as a user message
3. **Question**: The user's actual question is provided separately

### Image Pipeline

- PDFs are converted to markdown; embedded images are extracted and saved to `./images/`
- Images are uploaded to S3 (`s3-images` bucket) with deduplication (checks if image already exists)
- In chat responses, images are referenced as `[imageurl:filename.ext]`
- The `parse_content()` function detects these references and renders them via `st.image()`
- Images are cached locally in `./tmp_images/` after first download from S3