import streamlit as st
import os,json,requests,boto3,time
from static_vars import SETTINGS_PATH,FEEDBACK_PATH,MESSAGE_ANSWER
import boto3
import requests
from litellm import completion
import pymupdf4llm
import re
from PIL import Image
from io import BytesIO
import shutil

os.makedirs("images",exist_ok=True)
os.makedirs("tmp_images",exist_ok=True)

# Professional styling
st.set_page_config(
    layout='wide',
    page_title='SAV AI Assistant',
    page_icon='🤖',
)

# Custom CSS for professional styling
st.markdown("""
<style>
    /* Hide Streamlit branding */
    # #MainMenu {visibility: hidden;}
    # footer {visibility: hidden;}
    # header {visibility: hidden;}
    
    /* Main container styling */
    .main > div {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
    
    /* User message styling */
    .stChatMessage[data-testid="user"] {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
    }
    
    /* Assistant message styling */
    .stChatMessage[data-testid="assistant"] {
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        border: none;
    }
    gradient_cls {
    border: none;                 /* Remove default border */
    height: 4px;                   /* Thickness of the line */
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    border-radius: 2px;            /* Rounded edges (optional) */
    }
            

    /* Sidebar styling */
    .css-1d391kg {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
    }
    
    /* Title styling */
    .main-title {
        text-align: center;
        font-size: 3rem;
        font-weight: 700;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 2rem;
        text-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    /* Subtitle styling */
    .subtitle {
        text-align: center;
        color: #6c757d;
        font-size: 1.2rem;
        margin-bottom: 2rem;
    }
    
    /* Custom button styling */
    .stButton > button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 25px;
        padding: 0.5rem 2rem;
        font-weight: 600;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        transition: all 0.3s ease;
    }
    
    .stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
    }
    
    /* File uploader styling */
    .stFileUploader {
        border: 2px dashed #667eea;
        border-radius: 15px;
        padding: 2rem;
        text-align: center;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.05) 0%, rgba(118, 75, 162, 0.05) 100%);
    }
    
    /* Progress bar styling */
    .stProgress .st-bo {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    /* Success/Error message styling */
    .stSuccess {
        background: linear-gradient(135deg, #56ab2f 0%, #a8e6cf 100%);
        border-radius: 10px;
        padding: 1rem;
        border: none;
        color: white;
    }
    
    .stError {
        background: linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%);
        border-radius: 10px;
        padding: 1rem;
        border: none;
        color: white;
    }
    
    /* Sidebar title styling */
    .sidebar-title {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-size: 1.5rem;
        font-weight: 600;
        text-align: center;
        margin-bottom: 1rem;
        padding: 1rem;
        background: rgba(255,255,255,0.1);
        border-radius: 10px;
    }
    
    /* Chat input styling */
    .stChatInputContainer {
        border: 2px solid #667eea;
        border-radius: 25px;
        background: white;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);
    }
    
    /* Info box styling */
    .info-box {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        border-left: 4px solid #667eea;
        padding: 1rem;
        margin: 1rem 0;
        border-radius: 5px;
    }
    
    /* Loading spinner styling */
    .stSpinner {
        text-align: center;
        color: #667eea;
    }
</style>
""", unsafe_allow_html=True)

if "messsage" not in st.session_state:
    st.session_state.messsage=[("assistant","Hello 👋, How can i help you ? ")]

def answer(question,chat_container):
    model_name=st.session_state.settings["var_env"][1]
    context,related_sources=get_context_awsbd(question,aws_settings=st.session_state.settings)
    messages =MESSAGE_ANSWER.copy()
    messages.extend([
        {"role":"user","content":f"Context \n {context}"},
        {"role":"assistant","content":"now give me your full Question"},
        {"role":"user","content":f"Question \n {question}"}])
    
    resp = completion(
        model=model_name,
        messages=messages,
        stream=True
    )
    try:
        for chunk in resp:
            content=chunk.choices[0].delta.content
            if content:
                yield(content)
    except Exception as e:
        print("error chat_stream",str(e))
        for i in "Error \n"+str(e):
            yield i


def get_context_awsbd(question,aws_settings):
    
    ACCESS_KEY=aws_settings['keys']['AWS_ACCESS_KEY_ID']
    SECRET_KEY=aws_settings['keys']['AWS_SECRET_ACCESS_KEY']
    REGION=aws_settings['keys']['AWS_REGION_NAME']
    try:
        numberOfResults=aws_settings["kn_query"][0]
    except:
        numberOfResults=10
    bedrock_agent_runtime_client = boto3.client("bedrock-agent-runtime",aws_access_key_id=ACCESS_KEY,aws_secret_access_key=SECRET_KEY, region_name=REGION)
    kb_id=aws_settings['keys']['knowledge_base_id'] #idknowledge_base
    
    # print("Knowledge bases--",len(kb_id))

    full_context=""
    for id_ in kb_id:
        relevant_documents = bedrock_agent_runtime_client.retrieve(
        retrievalQuery= {
            'text': question
        },
        knowledgeBaseId=id_,
        retrievalConfiguration= {
            'vectorSearchConfiguration': {
                'numberOfResults': numberOfResults # will fetch top 3 documents which matches closely with the query.
            }
            }
        )
        related_sources=[]
        # print(relevant_documents)
        for i in relevant_documents["retrievalResults"]:
            full_context=full_context+"/---------/"+str(i['content']['text'])
            try:
                related_sources.append(i['metadata']["x-amz-bedrock-kb-source-uri"])
            except Exception as e:
                print("exception related sources",str(e))
        print(set(related_sources))
    return full_context,set(related_sources)

# sys.stdout=open(LOG_PATH,"a")
# sys.stderr=open(LOGERROR_PATH,"a")

def read_settings(path=SETTINGS_PATH):
    try:
        with open(path, 'r') as setting:
            data = json.load(setting)
        var_env=data["var_env"][0]
        for name,value in var_env:
            os.environ[name]=value
    except:
        data={
                "Llm_framework": "Litellm",
                "BDtype": [
                    "AWS_KB",
                    "smart",
                    "True",
                    "1000"
                ],
                "db_server": "",
                "keys": {
                    "AWS_ACCESS_KEY_ID": "",
                    "AWS_SECRET_ACCESS_KEY": "",
                    "AWS_REGION_NAME": "us-east-1",
                    "AWS_Model_NAME": "",
                    "knowledge_base_id": [
                    ],
                    "data_source_id": [
                    ],
                    "s3_name": "",
                    "s3-images":""
                },
                "var_env": [
                    [
                        [
                            "AWS_ACCESS_KEY_ID",
                            ""
                        ],
                        [
                            "AWS_SECRET_ACCESS_KEY",
                            ""
                        ],
                        [
                            "AWS_REGION_NAME",
                            "us-east-1"
                        ]
                    ],
                    ""
                ],
                "kn_query": [
                    10,
                    2,
                    "similarity"
                ]
                    
                }
        try:
            json_data = json.dumps(data)
                # write the JSON string to a file
            with open(path, 'w') as f:
                f.write(json_data)
        except Exception as e:
            print("failed to save settings",str(e))

    return data

def convert_image_to_binary(image_path):
    with Image.open(image_path) as img:

        img_byte_array = BytesIO()

        img.save(img_byte_array, format=img.format)

        img_byte_array.seek(0)
    return img_byte_array

def save_images_s3():
    aws_settings=st.session_state.settings
    ACCESS_KEY=aws_settings['keys']['AWS_ACCESS_KEY_ID']
    SECRET_KEY=aws_settings['keys']['AWS_SECRET_ACCESS_KEY']
    REGION=aws_settings['keys']['AWS_REGION_NAME']
    aws_bucket_name=aws_settings['keys']['s3-images']
    s3_client = boto3.client(
        's3',
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name=REGION
    )
    folder_path = "./images"
    if os.path.exists(folder_path):
        for filename in os.listdir(folder_path):
            file_path = os.path.join(folder_path, filename)
            if os.path.isfile(file_path):
                image_path=f"./images/{filename}"                
                image_data = convert_image_to_binary(image_path)
                try:
                    try:
                        s3_client.head_object(Bucket=aws_bucket_name, Key=filename)
                        print(f"Image exist already in {aws_bucket_name}/{filename}")

                    except :
                        s3_client.upload_fileobj(image_data,aws_bucket_name,filename)
                        print(f"Image successfully uploaded to S3 at {aws_bucket_name}/{filename}")
                except Exception as e:
                    print(f"Error uploading image: {e}")

        # Delete the folder after iteration
        shutil.rmtree(folder_path)
        print(f"Deleted folder: {folder_path}")
    else:
        print(f"Folder '{folder_path}' does not exist.")

def download_image(image_name):
    aws_settings=st.session_state.settings
    ACCESS_KEY=aws_settings['keys']['AWS_ACCESS_KEY_ID']
    SECRET_KEY=aws_settings['keys']['AWS_SECRET_ACCESS_KEY']
    REGION=aws_settings['keys']['AWS_REGION_NAME']
    aws_bucket_name=aws_settings['keys']['s3-images']
    # Initialize S3 client
    s3_client = boto3.client(
        's3',
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name=REGION
    )

    # S3 bucket and file details
    bucket_name = aws_bucket_name
    object_key = image_name  # S3 key (path inside bucket)
    download_path = f"./tmp_images/{image_name}"            # Local filename to save

    try:
        s3_client.download_file(bucket_name, object_key, download_path)
        print(f"Downloaded: {object_key} → {download_path}")
    except Exception as e:
        print(f"Error downloading {object_key} from S3: {e}")


def parse_content(s):
    # Pattern to match [imageurl:name.ext] and extract just name.ext
    pattern = r'\[imageurl:([^\[\]]+\.(?:jpg|jpeg|png|gif|bmp|webp))\]'
    parts = []
    last_index = 0

    for match in re.finditer(pattern, s, re.IGNORECASE):
        start, end = match.span()
        image_name = match.group(1)

        # Text before image
        if start > last_index:
            text_part = s[last_index:start].strip()
            if text_part:
                parts.append(("text", text_part))

        # Image part without "imageurl:"
        parts.append(("image", image_name.strip()))
        last_index = end

    # Remaining text after last image
    if last_index < len(s):
        remaining = s[last_index:].strip()
        if remaining:
            parts.append(("text", remaining))

    return parts

def pdf_to_md(file,file_name):
    with open(f"{file_name}","+wb") as tmp_pdf:
        tmp_pdf.write(file.read())
        # tmp_pdf_path = tmp_pdf.name
    # Convert saved PDF to markdown
    markdown = pymupdf4llm.to_markdown(f"{file_name}",write_images=True)
    save_images_s3()
    
    os.remove(file_name)

    return markdown

# st.set_page_config(layout='wide',page_title='AI4SAV')


file_exists_feedback = os.path.isfile(FEEDBACK_PATH)


try:
    if st.query_params["id_page"] == "1":
        try:
            st.title("Admin")
        except Exception as e:
            print("Feedback Exception",str(e))

except:
    st.markdown('<h1 class="main-title">🤖 SAV AI Assistant</h1>', unsafe_allow_html=True)
    st.markdown('<p class="subtitle">Your intelligent assistant powered by advanced AI</p><hr class="gradient_cls">', unsafe_allow_html=True)
    chat_tab=st.container()
    chat_container=chat_tab.container()

    for msg in st.session_state.messsage:
        list_parts=parse_content(str(msg[1]))
        bool_download_image=False
        with chat_container.chat_message(str(msg[0])):
            for i in list_parts:
                if i[0]=="image":
                    try:
                        # st.image("./tmp_images/"+i[1],width=500)
                        st.image("./tmp_images/"+i[1])
                        
                    except:
                        try:
                            download_image(i[1])
                            bool_download_image=True
                        except:
                            st.write(i[1])
                else:
                    st.write(i[1])
        if bool_download_image:
            st.rerun()
    user_message = st.chat_input(placeholder="💬 Type your message here...")

    # st.write("how to run reinitialization of RS485 Probes")

    if user_message:
        text=user_message
        st.session_state.messsage.append(("human",text))
        chat_container.chat_message("human").write(text)

        ##run reply
        final_answer=chat_container.chat_message("assistant").write_stream(answer(user_message,chat_container))
        st.session_state.messsage.append(("assistant",str(final_answer)))

        st.rerun()
        
    def set_files_tab():
        Add_files_tab=st.sidebar.container()
        with Add_files_tab:
            st.markdown('<div class="sidebar-title">📁 File Management</div>', unsafe_allow_html=True)

            settings=read_settings()
            st.session_state.settings=settings
            BDtype=settings['BDtype'][0]

            if BDtype=="AWS_KB":
                # Add_files_tab.title("Upload files to knowledge base")
                # File uploader
                uploaded_files = st.file_uploader(
                    "📤 Upload Documents",
                    type=["pdf", "csv", "xlsx", "txt"],
                    accept_multiple_files=True,
                    help="Supported formats: PDF, CSV, Excel, Text files"
                )

                if uploaded_files:
                    # Add_files_tab.write(f"File {uploaded_file.name} uploaded successfully.")
                    # file_ext=str.split(str(uploaded_file.name),".")[-1]
                    aws_settings=st.session_state.settings
                    S3_ACCESS_KEY=aws_settings['keys']['AWS_ACCESS_KEY_ID']
                    S3_SECRET_KEY=aws_settings['keys']['AWS_SECRET_ACCESS_KEY']
                    S3_REGION=settings['keys']['AWS_REGION_NAME']
                    S3_BUCKET = settings['keys']['s3_name'] 
                    try:
                        s3 = boto3.client(
                            "s3",
                            aws_access_key_id=S3_ACCESS_KEY,
                            aws_secret_access_key=S3_SECRET_KEY,
                            region_name=S3_REGION,
                        )
                        sync_kb_agent = boto3.client(
                            "bedrock-agent",
                            aws_access_key_id=S3_ACCESS_KEY,
                            aws_secret_access_key=S3_SECRET_KEY,
                            region_name=S3_REGION,
                        )
                    except:
                        st.error("Error durring config AWS client ,please verify the auth keys")

                    if st.button("Upload files"):
                        count_new_files=0
                        try:
                            progress_bar = st.progress(0)
                            total_files = len(uploaded_files)

                            for i, file in enumerate(uploaded_files):

                                #add two methods depend on type of db
                                try:
                                    filename = file.name.lower()
                                    
                                    if filename.endswith('.pdf'):
                                        # Convert PDF to text
                                        text = pdf_to_md(file,file.name)
                                        # st.write(text)
                                        tmp_path="tmp.txt"
                                        # Create a temporary .txt file
                                        with open(tmp_path, 'w',encoding="utf-8") as tmp:
                                            tmp.write(text)
                                        # Upload the .txt file to S3

                                        txt_s3_key = f"{os.path.splitext(file.name)[0]}.txt"
                                        try:
                                            s3.head_object(Bucket=S3_BUCKET, Key=txt_s3_key)
                                            print(f"Document exist already in {S3_BUCKET}/{txt_s3_key}")
                                        except:
                                            with open(tmp_path, 'rb') as f:
                                                s3.upload_fileobj(f, S3_BUCKET, txt_s3_key, ExtraArgs={"ContentType": "text/plain"})
                                            count_new_files+=1
                                        # Remove the temporary file
                                        os.remove(tmp_path)

                                    else:
                                        try:
                                            s3.head_object(Bucket=S3_BUCKET, Key=file.name)
                                            print(f"Document exist already in {S3_BUCKET}/{txt_s3_key}")
                                        except:
                                        # Upload non-PDF file as-is
                                            s3.upload_fileobj(file, S3_BUCKET, file.name, ExtraArgs={"ContentType": file.type})
                                            count_new_files+=1
                                except Exception as e:
                                    print(f"Error processing file {file.name}: {e}")


                                progress_bar.progress((i + 1) / total_files)

                            # st.success("All files uploaded!")
                        
                            with st.spinner("Sync with Knowledge Base... ⏳"):


                                # st.write(job_id)
                                # Wait for job to complete
                                try:
                                    if count_new_files>0:
                                        knowledgeBaseId=settings['keys']['knowledge_base_id']
                                        dataSourceId=settings['keys']['data_source_id']
                                        jobs_id=[""]*len(knowledgeBaseId)

                                        for ind ,kbid_ in enumerate(knowledgeBaseId):
                                            response = sync_kb_agent.start_ingestion_job(
                                                knowledgeBaseId=kbid_ , 
                                                dataSourceId=dataSourceId[ind], 
                                            )
                                            jobs_id[ind] = response["ingestionJob"]["ingestionJobId"]

                                        while True:
                                            status=[True]*len(knowledgeBaseId)
                                            for ind ,kbid_ in enumerate(knowledgeBaseId):
                                                status_response = sync_kb_agent.get_ingestion_job(
                                                    knowledgeBaseId=kbid_, 
                                                    dataSourceId=dataSourceId[ind], 
                                                    ingestionJobId=jobs_id[ind],
                                                )
                                                status[ind] = status_response["ingestionJob"]["status"]
                                                # print(f"KB id job {jobs_id[ind]},Status{status[ind]}")
                                            problem_statuses = ['FAILED', 'STOPPING', 'STOPPED']
                                            # print("status " ,status)
                                            if all(item == "COMPLETE" for item in status):
                                                st.success("Knowledge Base sync completed successfully! ✅")
                                                break
                                            elif any(s in status for s in problem_statuses):
                                                st.error("Knowledge Base sync failed. ❌")
                                                break
                                            
                                            time.sleep(5)  # Wait before checking again
                                        
                                except Exception as e:
                                    st.error("Error durring Sync")
                                    st.error(str(e))

                            st.success("Your files are now ready in the Knowledge Base! 🚀")

                        except:
                            st.error("Error durring uploading files to DB")

            #------------------------------------------------------------------
            elif BDtype=="ServerGDB":
                Add_files_tab.title("Upload files to knowledge base")
                db_url=settings['cloud']['db_server']
                split_type=settings["cloud"]['BDtype'][1]
                use_md=settings["cloud"]['BDtype'][2]
                chunk_length=settings["cloud"]['BDtype'][3]
                db_url = f"{db_url}/add_file"

                uploaded_files = Add_files_tab.file_uploader("Upload a PDF file", type=["pdf","csv","xlsx",'.txt'],accept_multiple_files=True)
                

                if uploaded_files:
                    # Add_files_tab.write(f"File {uploaded_file.name} uploaded successfully.")
                    # file_ext=str.split(str(uploaded_file.name),".")[-1]
                    if Add_files_tab.button("Uplaod files"):
                        try:
                            progress_bar = st.progress(0)
                            total_files = len(uploaded_files)

                            for i, file in enumerate(uploaded_files):

                                #add two methods depend on type of db
                                try:
                                    data={"Node_id":"47824","selected_analayser":"gr5","split_type":split_type,"use_md":use_md,
                                        "chunk_length":chunk_length}
                                    files = {
                                    'file': (file.name, file)
                                    }
                                    # Send the POST request
                                    response = requests.post(url=db_url, files=files,data=data)
                                    if "Success" in str(response.content):
                                        st.success(f"Uploaded {file.name} ✅")
                                    else:
                                        st.error(f"Failed {file.name} ")
                                    # st.write(f"[View File]({file_url})")
                                except Exception as e:
                                    st.error(f"Error uploading {file.name}: {e}")
                                
                                progress_bar.progress((i + 1) / total_files)

                            # st.success("All files uploaded!")

                            st.success("Your files are now ready in the Knowledge Base! 🚀")

                        except:
                            st.error("Error durring uploading files to DB")

            else:
                st.error("Please upload a file to continue.")

    set_files_tab()

