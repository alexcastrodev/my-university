---
version: 1.0
updatedAt: 2026-11-21
---
# Armazenamento em bloco, de arquivos e híbrido: EBS, instance store, EFS, FSx, Storage Gateway, AWS Backup e Elastic Disaster Recovery

> Domínio do exame: **Tecnologia e Serviços de Nuvem (34%)**, objetivo 3.6 *Identificar os serviços de armazenamento da AWS*.

---

## O que o exame quer

Do objetivo 3.6, esta lição cobre **armazenamento em bloco** (Amazon EBS, instance store), **serviços de arquivos** (Amazon EFS, Amazon FSx), **sistemas de arquivos em cache** (AWS Storage Gateway) e **casos de uso do AWS Backup**, além do AWS Elastic Disaster Recovery, da lista de serviços de armazenamento. As questões descrevem como os dados são usados e perguntam qual tipo de armazenamento serve.

---

## Objeto, bloco ou arquivo?

| Necessidade | Tipo de armazenamento | Serviço |
|-------------|-----------------------|---------|
| Armazenar qualquer quantidade de objetos e acessá-los por uma API de qualquer lugar | Objeto | **Amazon S3** (lição 3-4) |
| Um disco para uma instância EC2: volume de boot, arquivos de banco de dados | Bloco | **Amazon EBS** |
| Disco temporário muito rápido, fisicamente no host | Bloco | **Instance store** |
| Um sistema de arquivos compartilhado, montado por muitas instâncias Linux em várias AZs | Arquivo (NFS) | **Amazon EFS** |
| Compartilhamentos de arquivos do Windows (SMB) com o Active Directory | Arquivo (SMB) | **Amazon FSx for Windows File Server** |
| Aplicações no local (on-premises) usando o armazenamento da AWS por protocolos locais | Híbrido | **AWS Storage Gateway** |

---

## Amazon EBS

- Volumes de bloco persistentes para o EC2. Os dados de um volume são replicados entre vários servidores **dentro de uma AZ**, então o volume vive nessa AZ.
- Os **snapshots** são backups de um ponto no tempo. Você restaura um snapshot em um novo volume, inclusive em outra AZ, outra Região ou outra conta. É assim que você "move" um volume.
- O **Elastic Volumes** permite aumentar a capacidade ou mudar a performance sem tempo de inatividade. Você paga pelo que provisiona, seja usado ou não.
- Um volume normalmente é anexado a uma instância. O **Multi-Attach** (somente io1 e io2) anexa um volume a várias instâncias Nitro na mesma AZ; ele não pode ser um volume de boot.

| Família de volume | Tipos | Bom para | Volume de boot? |
|-------------------|-------|----------|-----------------|
| **SSD** | gp3, gp2 (uso geral); io2 Block Express, io1 (IOPS provisionadas) | Discos de boot, bancos de dados transacionais, E/S aleatória | Sim |
| **HDD** | st1 (otimizado para throughput), sc1 (frio) | Grandes leituras sequenciais, como logs e big data, menor custo | **Não** |

> Material de estudo antigo lista apenas gp2, io1 e Magnetic. A documentação oficial atual lista gp3, gp2, io2 Block Express, io1, st1 e sc1, e chama o Magnetic de tipo de geração anterior.

---

## Instance store

- Discos fisicamente conectados ao computador host. São muito rápidos e **não têm cobrança extra**.
- Os dados **sobrevivem a uma reinicialização**, mas são **perdidos quando a instância é parada, hibernada ou encerrada**.
- Use para buffers, caches, dados temporários ou dados replicados em outro lugar. Nunca para a única cópia de algo.
- Os dados do instance store NVMe são sempre criptografados em hardware, e as chaves são destruídas quando a instância é parada ou encerrada.

```text
 reboot     ->  instance store: kept      EBS: kept
 stop       ->  instance store: LOST      EBS: kept
 terminate  ->  instance store: LOST      EBS: kept unless deleted with the instance
```

---

## Armazenamento de arquivos: EFS e FSx

**Amazon EFS**

- Armazenamento de arquivos serverless e totalmente elástico, que cresce e diminui automaticamente; NFS (v4.0 e v4.1).
- Pode ser usado ao mesmo tempo a partir de EC2, ECS, EKS, Lambda e Fargate.
- Tipos de sistema de arquivos: **Regional** (recomendado, dados armazenados em várias AZs) e **One Zone** (uma AZ, os dados podem ser perdidos se a AZ for perdida).
- Classes de armazenamento: **Standard**, **Infrequent Access** e **Archive**, com gerenciamento de ciclo de vida que move os arquivos que não são acessados.
- Instâncias EC2 baseadas em Windows **não são aceitas**.

O **Amazon FSx** oferece sistemas de arquivos totalmente gerenciados, baseados em sistemas de arquivos populares. As ofertas atuais são FSx for NetApp ONTAP, FSx for OpenZFS, FSx for Windows File Server e FSx for Lustre (o FSx for Lustre está explicitamente fora do escopo deste exame).

- **FSx for Windows File Server**: servidores de arquivos Windows totalmente gerenciados, protocolo SMB, integração com o Microsoft Active Directory. A pista é "aplicação Windows, compartilhamentos SMB, permissões NTFS, usuários do AD".

| Pista na questão | Resposta |
|------------------|----------|
| Instâncias Linux em várias AZs compartilham os mesmos arquivos | **EFS** |
| Servidores Windows precisam de pastas compartilhadas com permissões do AD | **FSx for Windows File Server** |
| Uma instância precisa de um disco persistente | **EBS** |

---

## AWS Storage Gateway (armazenamento em cache e híbrido)

O Storage Gateway permite que aplicações no local (on-premises) usem o armazenamento da AWS por meio de protocolos padrão, mantendo os dados usados recentemente em um cache local.

| Tipo de gateway | Protocolo no local | Armazena os dados em |
|-----------------|--------------------|----------------------|
| **S3 File Gateway** | Compartilhamentos de arquivos NFS (v3, v4.1) e SMB (v2, v3) | Amazon S3, como objetos |
| **Volume Gateway** | Volumes de bloco iSCSI. **Cached**: dados no S3, dados quentes locais. **Stored**: todos os dados locais, snapshots assíncronos de um ponto no tempo para o S3 | S3, com os snapshots como snapshots do EBS (nos dois modos) |
| **Tape Gateway** | Biblioteca de fitas virtuais para o software de backup existente | S3, arquivando as fitas no Glacier Flexible Retrieval ou no Deep Archive |

O Amazon FSx File Gateway não está mais disponível para novos clientes, então não o escolha para um novo design.

---

## AWS Backup e AWS Elastic Disaster Recovery

| Serviço | O que faz | Pista |
|---------|-----------|-------|
| **AWS Backup** | Serviço totalmente gerenciado que **centraliza e automatiza** a proteção de dados entre serviços da AWS, na nuvem e no local, com políticas de backup (agendamentos, retenção) e monitoramento em um só lugar | "A mesma política de backup para EBS, RDS e EFS em um só lugar", "comprovar que os backups seguem a política" |
| **AWS Elastic Disaster Recovery** | Replica continuamente servidores no local ou na nuvem para uma área de preparação de baixo custo em uma Região da AWS escolhida e inicia instâncias de recuperação quando necessário; aceita simulações sem interrupção e failback | "Recuperar nossos servidores em execução na AWS após um desastre no site, e fazer o failback depois" |

- O AWS Backup governa apenas os backups feitos por meio do AWS Backup, não os snapshots que você automatizou por conta própria.
- O backup trata de **restaurar dados**; o Elastic Disaster Recovery trata de **colocar servidores inteiros de volta no ar** rapidamente na AWS.

**Não citado no guia do exame (apenas contexto):** a família AWS Snow de dispositivos físicos de transferência não está no guia do exame. O AWS Snowmobile foi encerrado em 2024 e o AWS Snowball Edge não está mais disponível para novos clientes, então os números de capacidade de livros mais antigos estão obsoletos.

---

## Atenção

- **O EBS é zonal.** Para usar os dados de um volume em outra AZ ou Região, crie um snapshot e um novo volume a partir dele.
- **st1 e sc1 não podem ser de boot.** Volumes de boot e bancos de dados precisam de SSD (gp3, gp2, io2, io1).
- **O instance store é perdido ao parar ou encerrar.** "Precisa sobreviver a uma parada" o descarta.
- **Sistema de arquivos compartilhado entre instâncias e AZs é EFS (Linux) ou FSx for Windows (Windows)**, não EBS. O Multi-Attach do EBS é limitado a io1 e io2 em uma AZ.
- **O EFS não aceita instâncias Windows.** Windows mais SMB significa FSx for Windows File Server.
- **"Sistema de arquivos em cache para o local (on-premises)" é o Storage Gateway.** Manter o software de fitas e enviar as fitas para a AWS: Tape Gateway.
- **O principal benefício do AWS Backup é o backup centralizado e baseado em políticas**, não servidores mais rápidos nem preços de armazenamento menores.

## Verificação rápida

1. Qual armazenamento perde seus dados quando a instância EC2 é parada? **Instance store.**
2. Trinta servidores web Linux em três AZs precisam ler e gravar os mesmos arquivos enviados. Qual serviço? **Amazon EFS.**
3. Uma aplicação Windows precisa de compartilhamentos SMB integrados ao Active Directory. Qual serviço? **Amazon FSx for Windows File Server.**
4. Uma empresa quer manter seu software de backup em fitas, mas parar de enviar fitas físicas. Qual serviço? **AWS Storage Gateway, Tape Gateway.**
5. Uma política precisa fazer backup diário de volumes EBS, bancos de dados RDS e sistemas de arquivos EFS. Qual serviço? **AWS Backup.**

## Documentação oficial

- [What is Amazon EBS](https://docs.aws.amazon.com/ebs/latest/userguide/what-is-ebs.html)
- [Amazon EBS volume types](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html)
- [Instance store temporary block storage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/InstanceStorage.html)
- [What is Amazon EFS](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html)
- [What is FSx for Windows File Server](https://docs.aws.amazon.com/fsx/latest/WindowsGuide/what-is.html)
- [What is AWS Storage Gateway](https://docs.aws.amazon.com/storagegateway/latest/vgw/WhatIsStorageGateway.html)
- [What is AWS Backup](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
- [What is AWS Elastic Disaster Recovery](https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html)
