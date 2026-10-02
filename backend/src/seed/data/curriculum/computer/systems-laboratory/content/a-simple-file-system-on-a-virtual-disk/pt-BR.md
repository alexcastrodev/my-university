---
version: 1.0
updatedAt: 2026-09-12
title: "Laboratório: um Sistema de Arquivos Simples num Disco Virtual"
summary: "Neste laboratório, um único arquivo comum na máquina hospedeira faz o papel de um disco bruto, formatado com o próprio layout de Arquivos, Diretórios e Inodes: um superbloco, uma tabela de inodes e uma região de blocos de dados acompanhada por um bitmap de blocos livres, que reaproveita a disciplina de gerenciamento de espaço livre do Laboratório 8 no nível de blocos em vez de bytes. Ele é exercitado por operações reais de criar, escrever, ler e apagar, e termina com uma falha deliberada injetada no meio de uma escrita para confirmar a afirmação de Implementação de Sistemas de Arquivos e Journaling de que só um sistema de arquivos com journaling, e não a primeira versão, de propósito mais simples, deste laboratório, de fato sobrevive a essa falha sem corrupção."
---
## Objetivos de Aprendizagem

- Implementar um layout simples em disco (um superbloco, uma tabela de inodes e uma região de blocos de dados) apoiado num único arquivo comum do hospedeiro fazendo o papel de um disco bruto.
- Implementar operações de criar, escrever, ler e apagar que atualizam corretamente o bitmap de blocos livres e os ponteiros de bloco do próprio inode afetado.
- Reaproveitar a disciplina de gerenciamento de espaço livre do Laboratório 8 no nível de blocos, acompanhando blocos de dados livres e alocados com um bitmap, em vez de reimplementar essa ideia do zero.
- Injetar uma falha deliberada no meio de uma escrita e confirmar, de forma empírica, que o projeto deste laboratório, de propósito sem journaling, não sobrevive a ela corretamente: o caso específico e concreto que o journaling existe para corrigir.

## Contexto e Motivação

**Implementação de Sistemas de Arquivos e Journaling** e **Arquivos, Diretórios e Inodes** já cobrem, na teoria, como um sistema de arquivos organiza um disco num superbloco, numa tabela de inodes e em blocos de dados, e por que uma atualização desprotegida de vários passos (alocar um bloco, depois escrever os dados, depois atualizar o ponteiro de um inode) fica vulnerável a deixar o disco num estado inconsistente se uma falha acontecer no meio do caminho. Este laboratório constrói um sistema de arquivos real e funcional que implementa esse layout, no espírito do trabalho oficial de verificador de sistemas de arquivos dos OSTEP-projects, sobre um único arquivo comum na máquina hospedeira fazendo o papel de um disco bruto.

## Teoria Central

Nada sobre *por que* um sistema de arquivos precisa de uma tabela de inodes separada das entradas de diretório, ou *por que* o journaling existe, é rederivado aqui; os dois argumentos já existem em `files-directories-and-inodes` e `file-system-implementation-and-journaling`. Este laboratório implementa de propósito a versão sem journaling desse projeto, justamente para que seu modo de falha real e concreto sob uma falha possa ser observado diretamente, e não só descrito.

## Exemplos Resolvidos

### O layout em disco, como um mapa de deslocamentos

```text
Bloco 0:              Superbloco (total de blocos, número de inodes,
                       deslocamento do início da lista livre; lido uma vez, na montagem)
Blocos 1..N:           Tabela de inodes (structs de inode de tamanho fixo, um por
                       arquivo possível: tamanho, ponteiros de bloco, tipo)
Bloco N+1:             Bitmap de blocos livres (um bit por bloco de dados abaixo)
Blocos N+2..fim:       Blocos de dados (conteúdo bruto dos arquivos, um bloco por
                       entrada de ponteiro de bloco de inode)
```

### Passo 1: montagem: um disco virtual é só um arquivo comum do hospedeiro

```c
typedef struct {
    FILE *disk_file;      // um arquivo comum do hospedeiro fazendo o papel de disco bruto
    superblock_t sb;
    uint8_t *free_bitmap;  // carregado na memória a partir do Bloco N+1 na montagem
} filesystem_t;

filesystem_t *mount(const char *disk_path) {
    filesystem_t *fs = malloc(sizeof(filesystem_t));
    fs->disk_file = fopen(disk_path, "r+b");
    fseek(fs->disk_file, 0, SEEK_SET);
    fread(&fs->sb, sizeof(superblock_t), 1, fs->disk_file);
    fs->free_bitmap = load_bitmap(fs->disk_file, &fs->sb);
    return fs;
}
```

### Passo 2: criando um arquivo: alocar um inode, inicializá-lo, escrevê-lo de volta

```c
int fs_create(filesystem_t *fs, const char *name) {
    int inum = find_free_inode(fs);  // percorre o bitmap de inodes em memória
    if (inum < 0) return -1;         // não sobrou nenhuma vaga de inode livre

    inode_t inode = { .size = 0, .type = FILE_TYPE, .block_count = 0 };
    write_inode(fs, inum, &inode);   // uma escrita em disco: Bloco (1 + inum/inodes_per_block)
    add_directory_entry(fs, name, inum);  // uma segunda escrita em disco: o próprio bloco de dados do diretório
    return inum;
}
```

### Passo 3: escrevendo dados: alocar um bloco (reaproveitando a disciplina de bitmap do Laboratório 8), escrevê-lo e SÓ DEPOIS atualizar o inode

```c
int fs_write(filesystem_t *fs, int inum, const void *data, size_t size) {
    int block_num = find_free_block(fs);  // percorre fs->free_bitmap: a MESMA
                                             // ideia de espaço livre baseada em
                                             // bitmap que o alocador malloc do
                                             // Laboratório 8 usou no nível de
                                             // bytes, reaproveitada aqui no
                                             // nível de blocos
    if (block_num < 0) return -1;

    mark_block_allocated(fs, block_num);         // passo A: atualiza o bitmap
    write_data_block(fs, block_num, data, size); // passo B: escreve os dados reais
    inode_t inode = read_inode(fs, inum);
    inode.blocks[inode.block_count++] = block_num;
    inode.size += size;
    write_inode(fs, inum, &inode);               // passo C: aponta o inode para ele
    return 0;
}
```

Três escritas separadas em disco (a atualização do bitmap, o bloco de dados e o próprio ponteiro do inode), nenhuma delas atômica em relação às outras, são exatamente a vulnerabilidade que `file-system-implementation-and-journaling` descreve na teoria; o Passo 4 a torna real.

### Passo 4: injetando uma falha no meio da escrita e observando corrupção real em disco

```c
int fs_write_with_injected_crash(filesystem_t *fs, int inum, const void *data, size_t size) {
    int block_num = find_free_block(fs);
    mark_block_allocated(fs, block_num);
    write_data_block(fs, block_num, data, size);
    fflush(fs->disk_file);
    exit(1);  // falha simulada: a atualização do inode abaixo NUNCA acontece
    // inode_t inode = read_inode(fs, inum);
    // ... (não alcançado)
}
```

```text
$ ./fs_test --inject-crash-after-block-write
$ ./fsck my_virtual_disk.img

CORRUPÇÃO DETECTADA: o bloco 42 está marcado como ALOCADO no bitmap, mas
nenhum inode o referencia (um bloco "vazado": espaço que nunca pode ser
recuperado por este projeto simples, já que nada aponta de volta para ele
para confirmar que está de fato em uso por um arquivo real).
```

Um pequeno verificador de sistema de arquivos (`fsck`), no espírito do trabalho oficial de verificador de sistemas de arquivos dos OSTEP-projects, compara o bitmap com os ponteiros de bloco reais de cada inode e relata exatamente essa discrepância: a consequência concreta, observável e em disco da escrita de três passos, não atômica, que este laboratório deliberadamente não protegeu com um journal.

## Equívocos Comuns e Armadilhas

- **"Uma falha entre essas três escritas é um caso extremo raro e improvável, que não vale a pena construir um teste real."** A falha injetada de propósito no Passo 4 é o objetivo inteiro de construir primeiro a versão mais simples, sem journaling, deste laboratório: tornar a falha reproduzível e observável sob demanda é o que transforma "o journaling importa" de afirmação em algo que o próprio `fsck` deste laboratório consegue detectar e relatar de forma concreta.
- **"Acompanhar blocos livres num sistema de arquivos é um problema completamente diferente de acompanhar espaço livre num alocador de memória."** O Passo 3 reaproveita de propósito a mesma ideia baseada em bitmap que a lista livre do próprio Laboratório 8 atendeu no nível de bytes, agora aplicada no nível de blocos; o problema subjacente (acompanhar quais unidades de armazenamento de tamanho fixo estão em uso no momento) tem a mesma forma na camada de um alocador de memória e na de um sistema de arquivos.
- **"Detectar a corrupção depois do fato significa que o estrago da falha já foi consertado."** A saída do `fsck` no Passo 4 detecta a inconsistência, mas não a repara automaticamente no projeto, de propósito simples, deste laboratório; o bloco vazado continua permanentemente inutilizável, a não ser que um passo de reparo separado o recupere, e é precisamente por isso que `file-system-implementation-and-journaling` argumenta que o journaling, impedindo que a inconsistência sequer ocorra, é o projeto mais forte no mundo real.

## Resumo

Este laboratório constrói um sistema de arquivos real e funcional (um superbloco, uma tabela de inodes e uma região de blocos de dados) sobre um único arquivo comum do hospedeiro fazendo o papel de um disco bruto, com operações de criar, escrever e apagar que reaproveitam, no nível de blocos, a própria disciplina de espaço livre baseada em bitmap do Laboratório 8. Construir de propósito primeiro a versão mais simples, sem journaling, e depois injetar uma falha real entre a escrita de dados e a atualização correspondente do inode é o que transforma a afirmação teórica de `file-system-implementation-and-journaling` sobre a vulnerabilidade das atualizações de vários passos numa corrupção observável, detectável pelo `fsck`, num disco virtual de verdade: exatamente a falha concreta que o journaling existe para impedir.

## Documentation Links

- [OSTEP Projects: File System Checker](https://github.com/remzi-arpacidusseau/ostep-projects): o trabalho real e oficial em cujo espírito se inspiram a detecção de falhas e a verificação no estilo `fsck` deste laboratório.
- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "File System Implementation"](https://pages.cs.wisc.edu/~remzi/OSTEP/file-implementation.pdf): a fonte do layout de superbloco, tabela de inodes e blocos de dados que este laboratório implementa.
